import { describe, expect, it, vi } from 'vitest'
import {
  DAILY_INSTRUCTIONS,
  DAILY_VARIANTS,
  DAILY_SECTION_NAME,
  DAILY_SECTION_ORDER,
  DAILY_SECTION_TOKEN_BUDGET,
  apply,
  decorateAgent,
  estimateTokens,
  isDailyTarget,
  type DecoratableAgent,
} from '../src/index.ts'

/**
 * Build an agent whose durable record names one preset.
 *
 * The preset is expressed as the official records — a creation header plus the
 * logged selection events — because that is what the official resolver reads,
 * and a fake that stored the preset directly would not exercise the switch
 * case below.
 * @param options - Creation preset and any later blank-window selections.
 * @returns The stub agent plus the sections it received.
 */
function makeAgent(options: { created: string, selected?: readonly string[] }): {
  agent: DecoratableAgent
  sections: { name: string, order: number, text: string }[]
  disposals: number
} {
  const sections: { name: string, order: number, text: string }[] = []
  let disposals = 0
  const teardowns: (() => void)[] = []
  const agent: DecoratableAgent = {
    id: 'session-1',
    session: {
      header: { agentPreset: options.created },
      // Session events carry their payload under `data`, which is what the
      // official resolver reads; a flattened fake would pass here and fail
      // against the real runtime.
      events: (options.selected ?? []).map((preset) => ({
        type: 'agent-preset/selected',
        data: { agentPreset: preset },
      })),
    },
    ctx: {
      systemPrompt: {
        section(section) {
          sections.push(section)
          return () => {
            const index = sections.indexOf(section)
            if (index >= 0) sections.splice(index, 1)
          }
        },
      },
      effect(callback) {
        const teardown = callback()
        const dispose = (): void => {
          disposals += 1
          if (typeof teardown === 'function') teardown()
        }
        teardowns.push(dispose)
        return dispose
      },
    },
  }
  return {
    agent,
    sections,
    get disposals() {
      return disposals
    },
  }
}

describe('daily decoration targets official Standard only', () => {
  it('decorates a Standard session', () => {
    expect(isDailyTarget(makeAgent({ created: 'standard' }).agent)).toBe(true)
  })

  it.each([
    ['minimal', 'Minimal is a fixed-prompt benchmark composition'],
    ['code', 'PTC is a deliberate tool-presentation choice'],
    ['cordis', 'Creator is a preset-authoring composition'],
    ['my-custom-preset', 'a user preset is a complete composition this distribution may not edit'],
  ])('leaves %s undecorated (%s)', (preset) => {
    expect(isDailyTarget(makeAgent({ created: preset }).agent)).toBe(false)
  })

  it('follows a preset switch made while the session was blank', () => {
    // The header alone would rebuild the session under its creation-time preset;
    // the official resolver folds the later selection over it.
    expect(isDailyTarget(makeAgent({ created: 'minimal', selected: ['standard'] }).agent)).toBe(true)
    expect(isDailyTarget(makeAgent({ created: 'standard', selected: ['minimal'] }).agent)).toBe(false)
  })

  it('takes the newest selection when several were logged', () => {
    expect(isDailyTarget(makeAgent({ created: 'standard', selected: ['minimal', 'standard'] }).agent)).toBe(true)
  })
})

describe('the daily section is registered on the agent scope', () => {
  it('registers exactly one section with its declared name and order', () => {
    const { agent, sections } = makeAgent({ created: 'standard' })
    decorateAgent(agent)
    expect(sections).toHaveLength(1)
    expect(sections[0]?.name).toBe(DAILY_SECTION_NAME)
    expect(sections[0]?.order).toBe(DAILY_SECTION_ORDER)
    expect(sections[0]?.text).toBe(DAILY_INSTRUCTIONS)
  })

  it('renders after the persona and before tool guidance', () => {
    // Daily policy qualifies the persona rather than replacing it, and must not
    // displace the tool instructions the official catalog contributes.
    expect(DAILY_SECTION_ORDER).toBeGreaterThan(0)
    expect(DAILY_SECTION_ORDER).toBeLessThan(100)
  })

  it('withdraws the section when the agent scope unwinds', () => {
    const { agent, sections } = makeAgent({ created: 'standard' })
    const dispose = decorateAgent(agent)
    expect(sections).toHaveLength(1)
    dispose()
    expect(sections).toHaveLength(0)
  })

  it('never declares itself the complete prompt, which would erase the official persona', () => {
    const { agent, sections } = makeAgent({ created: 'standard' })
    decorateAgent(agent)
    expect(sections[0]).not.toHaveProperty('complete')
  })
})

describe('concurrent sessions stay isolated', () => {
  it('gives the daily section only to the Standard agent', () => {
    const standard = makeAgent({ created: 'standard' })
    const minimal = makeAgent({ created: 'minimal' })
    const listeners: ((payload: { agent: DecoratableAgent }) => void)[] = []
    const host = {
      on: (_event: 'agent/created', listener: (payload: { agent: DecoratableAgent }) => void) => {
        listeners.push(listener)
        return () => {}
      },
    }
    apply(host)
    for (const listener of listeners) {
      listener({ agent: standard.agent })
      listener({ agent: minimal.agent })
    }
    expect(standard.sections).toHaveLength(1)
    expect(minimal.sections).toHaveLength(0)
  })

  it('does not subscribe at all when the profile disables decoration', () => {
    const on = vi.fn(() => () => {})
    apply({ on }, { enabled: false })
    expect(on).not.toHaveBeenCalled()
  })
})

describe('the standing instructions stay inside their request-prefix budget', () => {
  it('fits the declared budget', () => {
    const estimate = estimateTokens(DAILY_INSTRUCTIONS)
    expect(
      estimate,
      `the daily section is re-sent every request; ${estimate} exceeds the ${DAILY_SECTION_TOKEN_BUDGET} budget`,
    ).toBeLessThanOrEqual(DAILY_SECTION_TOKEN_BUDGET)
  })

  it('states the obligations the specs require', () => {
    for (const obligation of [
      /repository instructions/i,
      /Preserve state you were not asked to change/i,
      /does not authorize commit, push/i,
      /Verify with the narrowest project-owned checks/i,
      /a check you did not run is not evidence/i,
    ]) {
      expect(DAILY_INSTRUCTIONS).toMatch(obligation)
    }
  })

  it('no longer carries the boundary-testing paragraph, which measured worse', () => {
    // It was added on one uncontrolled before/after observation. A 360-run
    // three-way sweep put it at 89.2% verified against 92.5% for the official
    // baseline, losing bug-repair and multi-file-feature tasks the same model
    // solved without it. The text survives as the `full` variant so the
    // decision stays a reproducible comparison rather than an anecdote.
    expect(DAILY_INSTRUCTIONS).not.toMatch(/test the boundaries rather than the happy path/i)
    expect(DAILY_VARIANTS.full).toMatch(/test the boundaries rather than the happy path/i)
  })

  it('carries no framework-, language-, or workflow-specific guidance', () => {
    // Specialized procedure belongs in a Skill loaded when the task matches,
    // not in text paid for on every request of every session.
    for (const specialized of [/\breact\b/i, /\bpython\b/i, /\bdocker\b/i, /\bkubernetes\b/i, /\bnpm run\b/i]) {
      expect(DAILY_INSTRUCTIONS).not.toMatch(specialized)
    }
  })
})
