import { describe, expect, it, vi } from 'vitest'
import { apply, type DailyHost, type DecoratableAgent, type StepDecision } from '../src/index.ts'
import type { AdaptiveRuntime } from '../src/adaptive-mount.ts'

const EXACT_MINIMAL = {
  toolNames: ['bash', 'str_replace_editor'],
  sectionNames: ['deployment:persona'],
  promptText: 'You are a helpful software engineer assistant.',
}

/**
 * Build a host that records its listeners.
 * @returns The host plus the captured listeners.
 */
function hostOf(): {
  host: DailyHost & { reportAdaptiveRefusal: ReturnType<typeof vi.fn> }
  created: ((payload: { agent: DecoratableAgent }) => void)[]
  preStep: ((payload: { agent: DecoratableAgent }, next: () => Promise<StepDecision>) => Promise<StepDecision>)[]
} {
  const created: ((payload: { agent: DecoratableAgent }) => void)[] = []
  const preStep: ((payload: { agent: DecoratableAgent }, next: () => Promise<StepDecision>) => Promise<StepDecision>)[] = []
  const host = {
    reportAdaptiveRefusal: vi.fn(),
    on: (event: string, listener: never) => {
      if (event === 'agent/created') created.push(listener)
      else preStep.push(listener)
      return () => {}
    },
  } as never
  return { host, created, preStep }
}

/**
 * Build an agent with a durable log.
 * @param id - Session identity.
 * @param events - Durable events.
 * @returns The agent.
 */
function agentOf(id: string, events: { type: string }[] = []): DecoratableAgent {
  return {
    id,
    session: { header: { agentPreset: 'standard' }, events },
    ctx: {
      systemPrompt: { section: () => () => {} },
      effect: (callback: () => (() => void) | void) => {
        const teardown = callback()
        return () => {
          if (typeof teardown === 'function') teardown()
        }
      },
    },
  }
}

/**
 * Build an adaptive runtime.
 * @param identity - What the derivation returns.
 * @returns The runtime.
 */
function runtimeOf(identity = EXACT_MINIMAL): AdaptiveRuntime {
  return {
    mountPreset: vi.fn(async () => {}),
    recompose: vi.fn(async () => {}),
    deriveIdentity: async () => identity,
  }
}

describe('adaptive stays off unless everything opts in', () => {
  it('registers no pre-step listener by default', () => {
    const { host, preStep } = hostOf()
    apply(host, {}, runtimeOf())
    expect(preStep).toHaveLength(0)
  })

  it('registers none when the flag is set but no runtime is supplied', () => {
    // Without a runtime the experiment would be half-installed, which is worse
    // than off: a session could select it and get ordinary behavior silently.
    const { host, preStep } = hostOf()
    apply(host, { adaptive: true })
    expect(preStep).toHaveLength(0)
  })

  it('registers the listener when the profile enables it with a runtime', () => {
    const { host, preStep } = hostOf()
    apply(host, { adaptive: true, adaptiveSessions: ['s1'] }, runtimeOf())
    expect(preStep).toHaveLength(1)
  })
})

describe('only sessions that selected adaptive are affected', () => {
  it('delegates untouched for a session that did not select it', async () => {
    const { host, preStep } = hostOf()
    apply(host, { adaptive: true, adaptiveSessions: ['s1'] }, runtimeOf())
    const next = vi.fn(async (): Promise<StepDecision> => ({ kind: 'enter', messages: [] }))
    const decision = await preStep[0]!({ agent: agentOf('other') }, next)
    expect(next).toHaveBeenCalledOnce()
    expect(decision).toEqual({ kind: 'enter', messages: [] })
  })

  it('prepares the step for a selected session and then delegates', async () => {
    const { host, preStep } = hostOf()
    const runtime = runtimeOf()
    apply(host, { adaptive: true, adaptiveSessions: ['s1'] }, runtime)
    const next = vi.fn(async (): Promise<StepDecision> => ({ kind: 'enter', messages: [] }))
    await preStep[0]!({ agent: agentOf('s1') }, next)
    expect(runtime.mountPreset).toHaveBeenCalledWith(expect.anything(), 'minimal')
    expect(next).toHaveBeenCalledOnce()
  })
})

describe('an unprovable identity rejects the step before the model runs', () => {
  it('returns reject and never delegates', async () => {
    const { host, preStep } = hostOf()
    apply(
      host,
      { adaptive: true, adaptiveSessions: ['s1'] },
      runtimeOf({ ...EXACT_MINIMAL, toolNames: ['bash', 'read', 'write'] }),
    )
    const next = vi.fn(async (): Promise<StepDecision> => ({ kind: 'enter', messages: [] }))
    const decision = await preStep[0]!({ agent: agentOf('s1') }, next)
    expect(decision).toEqual({ kind: 'reject' })
    // Delegating would send the step; the whole point is that it does not.
    expect(next).not.toHaveBeenCalled()
  })

  it('reports an actionable refusal to the surface', async () => {
    const { host, preStep } = hostOf()
    apply(
      host,
      { adaptive: true, adaptiveSessions: ['s1'] },
      runtimeOf({ ...EXACT_MINIMAL, sectionNames: ['a', 'b'] }),
    )
    await preStep[0]!({ agent: agentOf('s1') }, async () => ({ kind: 'enter', messages: [] }))
    expect(host.reportAdaptiveRefusal).toHaveBeenCalledWith(expect.stringMatching(/daily mode is unaffected/i))
  })
})

describe('a promoted session delegates without remounting', () => {
  it('recomposes once and then enters the step', async () => {
    const { host, preStep } = hostOf()
    const runtime = runtimeOf()
    apply(host, { adaptive: true, adaptiveSessions: ['s1'] }, runtime)
    const next = vi.fn(async (): Promise<StepDecision> => ({ kind: 'enter', messages: [] }))
    const agent = agentOf('s1', [{ type: 'assistant/message' }])
    await preStep[0]!({ agent }, next)
    await preStep[0]!({ agent }, next)
    expect(runtime.recompose).toHaveBeenCalledTimes(1)
    expect(runtime.mountPreset).not.toHaveBeenCalled()
    expect(next).toHaveBeenCalledTimes(2)
  })
})

describe('disposal withdraws both listeners', () => {
  it('returns one disposer covering the whole registration', () => {
    const { host } = hostOf()
    expect(() => apply(host, { adaptive: true, adaptiveSessions: ['s1'] }, runtimeOf())()).not.toThrow()
  })
})
