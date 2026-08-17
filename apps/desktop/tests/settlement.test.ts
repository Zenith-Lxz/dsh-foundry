/**
 * A dialog result is delivered only to the renderer that is still current.
 *
 * A native dialog is modal to the user but not to the application: the host can
 * restart and the window can be replaced while it is open. Delivering the
 * result anyway hands a chosen path to a renderer that no longer owns the
 * session, and resolves a request belonging to a generation that is gone.
 * @module apps/desktop/tests/settlement.test
 */
import { describe, expect, it } from 'vitest'
import { settlementFailure, type SettlementFacts } from '../src/main/bridge.ts'

/** The facts of a dialog that opened and returned with nothing having changed. */
const unchanged: SettlementFacts = {
  requestGeneration: 3,
  currentGeneration: 3,
  senderDestroyed: false,
  senderWebContentsId: 7,
  currentWebContentsId: 7,
}

/**
 * The same dialog with something changed underneath it.
 * @param overrides - Facts to change.
 * @returns The facts to judge.
 */
const facts = (overrides: Partial<SettlementFacts>): SettlementFacts => ({ ...unchanged, ...overrides })

describe('a result settles when nothing moved underneath it', () => {
  it('delivers when the generation and renderer are unchanged', () => {
    expect(settlementFailure(unchanged)).toBeUndefined()
  })
})

describe('a result is dropped when its owner is gone', () => {
  it('refuses after a host restart', () => {
    const failure = settlementFailure(facts({ currentGeneration: 4 }))
    expect(failure?.code).toBe('superseded')
    expect(failure?.message).toContain('generation changed while the dialog was open')
  })

  it('refuses after the requesting renderer was destroyed', () => {
    const failure = settlementFailure(facts({ senderDestroyed: true }))
    expect(failure?.code).toBe('superseded')
    expect(failure?.message).toContain('no longer current')
  })

  it('refuses when the window was replaced by a different renderer', () => {
    expect(settlementFailure(facts({ currentWebContentsId: 8 }))?.code).toBe('superseded')
  })

  it('refuses when there is no current window at all', () => {
    expect(settlementFailure(facts({ currentWebContentsId: undefined }))?.code).toBe('superseded')
  })

  it('reports the generation change first, since it explains the renderer change too', () => {
    // A restart replaces the window, so both facts differ; naming the renderer
    // would describe the symptom rather than the cause.
    const failure = settlementFailure(facts({ currentGeneration: 4, currentWebContentsId: 8 }))
    expect(failure?.message).toContain('generation changed')
  })

  it('carries no selected path, because a refused settlement never had one', () => {
    const failure = settlementFailure(facts({ currentGeneration: 9 }))
    expect(failure?.message).not.toMatch(/\//)
  })
})
