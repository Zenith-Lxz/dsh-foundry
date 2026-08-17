import { describe, expect, it, vi } from 'vitest'
import {
  describeRefusal,
  prepareAdaptiveRequest,
  type AdaptiveAgent,
  type AdaptiveRuntime,
} from '../src/adaptive-mount.ts'
import type { DerivedIdentity, PhaseEvent } from '../src/adaptive.ts'

/** The identity a real live derivation produced on this DSH version. */
const EXACT_MINIMAL: DerivedIdentity = {
  toolNames: ['bash', 'str_replace_editor'],
  sectionNames: ['deployment:persona'],
  promptText: 'You are a helpful software engineer assistant.',
}

/**
 * Build an adaptive agent with a given durable log.
 * @param events - Durable session events.
 * @param id - Agent identity.
 * @returns The agent.
 */
function agentOf(events: PhaseEvent[], id = 'session-1'): AdaptiveAgent {
  return { id, ctx: { scope: id }, session: { events } }
}

/**
 * Build a runtime whose calls are recorded.
 * @param identity - What the derivation returns.
 * @returns The runtime plus its call spies.
 */
function runtimeOf(identity: DerivedIdentity = EXACT_MINIMAL): AdaptiveRuntime & {
  mountPreset: ReturnType<typeof vi.fn>
  recompose: ReturnType<typeof vi.fn>
} {
  return {
    mountPreset: vi.fn(async () => {}),
    recompose: vi.fn(async () => {}),
    deriveIdentity: async () => identity,
  }
}

describe('the first request runs under Minimal', () => {
  it('mounts the official minimal preset and reports the fingerprint', async () => {
    const runtime = runtimeOf()
    const result = await prepareAdaptiveRequest(agentOf([{ type: 'user/message' }]), runtime, new Set())
    expect(result).toMatchObject({ ok: true, phase: 'minimal-first' })
    expect(runtime.mountPreset).toHaveBeenCalledWith({ scope: 'session-1' }, 'minimal')
    expect(runtime.recompose).not.toHaveBeenCalled()
  })

  it('refuses the request when the derived identity is not exactly Minimal', async () => {
    // The comparison the experiment exists to make would be silently invalid,
    // and no downstream number would reveal it.
    const runtime = runtimeOf({ ...EXACT_MINIMAL, toolNames: ['bash', 'read', 'write'] })
    const result = await prepareAdaptiveRequest(agentOf([{ type: 'user/message' }]), runtime, new Set())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal.reason).toBe('identity-not-exact')
  })

  it('refuses when the preset cannot be mounted', async () => {
    const runtime = runtimeOf()
    runtime.mountPreset.mockRejectedValueOnce(new Error('unscoped context'))
    const result = await prepareAdaptiveRequest(agentOf([]), runtime, new Set())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal.reason).toBe('mount-failed')
  })

  it('never derives an identity it did not mount for', async () => {
    const runtime = runtimeOf()
    runtime.mountPreset.mockRejectedValueOnce(new Error('boom'))
    const deriveIdentity = vi.fn(async () => EXACT_MINIMAL)
    await prepareAdaptiveRequest(agentOf([]), { ...runtime, deriveIdentity }, new Set())
    expect(deriveIdentity).not.toHaveBeenCalled()
  })
})

describe('promotion happens once and is one-way', () => {
  it('recomposes to standard after the model has answered', async () => {
    const runtime = runtimeOf()
    const result = await prepareAdaptiveRequest(
      agentOf([{ type: 'user/message' }, { type: 'assistant/message' }]),
      runtime,
      new Set(),
    )
    expect(result).toMatchObject({ ok: true, phase: 'promoted' })
    expect(runtime.recompose).toHaveBeenCalledWith({ scope: 'session-1' }, 'standard')
  })

  it('promotes on a tool call as well as a message', async () => {
    const runtime = runtimeOf()
    await prepareAdaptiveRequest(agentOf([{ type: 'tool/call' }]), runtime, new Set())
    expect(runtime.recompose).toHaveBeenCalledTimes(1)
  })

  it('does not recompose twice for the same agent', async () => {
    const runtime = runtimeOf()
    const promoted = new Set<string>()
    const agent = agentOf([{ type: 'assistant/message' }])
    await prepareAdaptiveRequest(agent, runtime, promoted)
    await prepareAdaptiveRequest(agent, runtime, promoted)
    await prepareAdaptiveRequest(agent, runtime, promoted)
    expect(runtime.recompose).toHaveBeenCalledTimes(1)
  })

  it('never mounts Minimal again once promoted', async () => {
    const runtime = runtimeOf()
    await prepareAdaptiveRequest(agentOf([{ type: 'assistant/message' }]), runtime, new Set())
    expect(runtime.mountPreset).not.toHaveBeenCalled()
  })

  it('refuses the request when recomposition fails, rather than running a half catalog', async () => {
    // Neither Minimal nor complete is the one state that must never reach the
    // model, because no later record would show which catalog it saw.
    const runtime = runtimeOf()
    runtime.recompose.mockRejectedValueOnce(new Error('row unusable'))
    const result = await prepareAdaptiveRequest(agentOf([{ type: 'assistant/message' }]), runtime, new Set())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal.reason).toBe('promotion-failed')
  })

  it('leaves the agent unpromoted after a failed recomposition, so a retry can succeed', async () => {
    const runtime = runtimeOf()
    const promoted = new Set<string>()
    runtime.recompose.mockRejectedValueOnce(new Error('transient'))
    await prepareAdaptiveRequest(agentOf([{ type: 'assistant/message' }]), runtime, promoted)
    expect(promoted.size).toBe(0)
    const retry = await prepareAdaptiveRequest(agentOf([{ type: 'assistant/message' }]), runtime, promoted)
    expect(retry.ok).toBe(true)
  })
})

describe('resume converges without stored state', () => {
  it('runs Minimal again for a session restored before any model output', async () => {
    const runtime = runtimeOf()
    const result = await prepareAdaptiveRequest(agentOf([{ type: 'user/message' }]), runtime, new Set())
    expect(result).toMatchObject({ phase: 'minimal-first' })
  })

  it('goes straight to the full catalog for a session restored after output', async () => {
    // A fresh process has an empty promoted set; the durable log is what
    // decides, so no state had to survive the restart.
    const runtime = runtimeOf()
    const result = await prepareAdaptiveRequest(
      agentOf([{ type: 'user/message' }, { type: 'tool/call' }, { type: 'assistant/message' }]),
      runtime,
      new Set(),
    )
    expect(result).toMatchObject({ phase: 'promoted' })
    expect(runtime.mountPreset).not.toHaveBeenCalled()
  })
})

describe('concurrent adaptive sessions stay independent', () => {
  it('tracks promotion per agent', async () => {
    const runtime = runtimeOf()
    const promoted = new Set<string>()
    await prepareAdaptiveRequest(agentOf([{ type: 'assistant/message' }], 'a'), runtime, promoted)
    await prepareAdaptiveRequest(agentOf([{ type: 'user/message' }], 'b'), runtime, promoted)
    expect(promoted.has('a')).toBe(true)
    expect(promoted.has('b')).toBe(false)
    expect(runtime.mountPreset).toHaveBeenCalledWith({ scope: 'b' }, 'minimal')
  })
})

describe('refusals tell the user what is still available', () => {
  it.each([
    { reason: 'identity-not-exact', detail: 'tool-count' },
    { reason: 'mount-failed', detail: 'unscoped' },
    { reason: 'promotion-failed', detail: 'row unusable' },
  ] as const)('renders %o as an actionable sentence', (refusal) => {
    const message = describeRefusal(refusal)
    expect(message).toMatch(/Adaptive mode did not start/)
    expect(message).toMatch(/daily mode is unaffected/i)
  })

  it('bounds a long error instead of pasting a stack', async () => {
    const runtime = runtimeOf()
    runtime.mountPreset.mockRejectedValueOnce(new Error('x'.repeat(5000)))
    const result = await prepareAdaptiveRequest(agentOf([]), runtime, new Set())
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.refusal.detail.length).toBeLessThan(220)
  })
})
