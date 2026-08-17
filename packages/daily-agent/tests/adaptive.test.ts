import { describe, expect, it } from 'vitest'
import {
  MINIMAL_SECTION_NAME,
  MINIMAL_TOOL_NAMES,
  canChangeMode,
  checkMinimalIdentity,
  derivePhase,
  fingerprintIdentity,
  isAdaptivePhase,
  type DerivedIdentity,
} from '../src/adaptive.ts'

/**
 * The identity a real live derivation produced on this DSH version.
 *
 * Used as the *expected* case in tests, not as a source of truth for what
 * Minimal is: the product derives it at runtime, and this fixture only pins
 * what a correct derivation looked like when it was observed.
 */
const OBSERVED_MINIMAL: DerivedIdentity = {
  toolNames: ['bash', 'str_replace_editor'],
  sectionNames: ['deployment:persona'],
  promptText: 'You are a helpful software engineer assistant.',
}

describe('phase derives from durable records alone', () => {
  it('is minimal-first when the log has no model output', () => {
    expect(derivePhase([{ type: 'session' }, { type: 'user/message' }])).toBe('minimal-first')
  })

  it('promotes on a durable assistant message', () => {
    expect(derivePhase([{ type: 'user/message' }, { type: 'assistant/message' }])).toBe('promoted')
  })

  it('promotes on a durable tool call', () => {
    expect(derivePhase([{ type: 'user/message' }, { type: 'tool/call' }])).toBe('promoted')
  })

  it('promotes even when the tool then failed', () => {
    // The model already chose a tool from the Minimal catalog, which is the
    // observation; whether the command succeeded says nothing about presentation.
    expect(derivePhase([{ type: 'tool/call' }, { type: 'tool/result' }])).toBe('promoted')
  })

  it('is order-independent, so a resumed log in any order yields the same phase', () => {
    expect(derivePhase([{ type: 'assistant/message' }, { type: 'user/message' }])).toBe('promoted')
  })

  it('stays promoted once promoted, with no record that can undo it', () => {
    const events = [{ type: 'assistant/message' }, { type: 'turn/end' }, { type: 'user/message' }]
    expect(derivePhase(events)).toBe('promoted')
  })

  it('ignores records that are neither model output nor a tool call', () => {
    expect(derivePhase([{ type: 'session' }, { type: 'turn/start' }, { type: 'step/start' }])).toBe('minimal-first')
  })
})

describe('the identity gate rejects anything that is not exactly Minimal', () => {
  it('accepts the identity a real derivation produced', () => {
    const check = checkMinimalIdentity(OBSERVED_MINIMAL)
    expect(check.exact).toBe(true)
  })

  it('rejects the global catalog, which is the real scoping mistake', () => {
    // An omitted ScopeKey returns every tool; this is what the first live
    // derivation actually produced.
    const check = checkMinimalIdentity({
      ...OBSERVED_MINIMAL,
      toolNames: ['bash', 'read', 'write', 'edit', 'grep', 'glob', 'str_replace_editor'],
    })
    expect(check).toMatchObject({ exact: false, mismatch: 'tool-count' })
    if (!check.exact) expect(check.detail).toMatch(/ScopeKey/)
  })

  it('rejects the right count with the wrong tools', () => {
    const check = checkMinimalIdentity({ ...OBSERVED_MINIMAL, toolNames: ['bash', 'read'] })
    expect(check).toMatchObject({ exact: false, mismatch: 'tool-names' })
  })

  it('rejects a global prompt assembly', () => {
    // Five sections is what the unscoped assembly returned; the complete
    // persona collapses it to one.
    const check = checkMinimalIdentity({
      ...OBSERVED_MINIMAL,
      sectionNames: ['harness:identity', 'harness:source', 'app:web-surface', 'deployment:persona', 'ui:x'],
    })
    expect(check).toMatchObject({ exact: false, mismatch: 'section-count' })
  })

  it('rejects a single section that is not the persona', () => {
    const check = checkMinimalIdentity({ ...OBSERVED_MINIMAL, sectionNames: ['harness:identity'] })
    expect(check).toMatchObject({ exact: false, mismatch: 'section-name' })
  })

  it('rejects an empty prompt', () => {
    const check = checkMinimalIdentity({ ...OBSERVED_MINIMAL, promptText: '   ' })
    expect(check).toMatchObject({ exact: false, mismatch: 'empty-prompt' })
  })

  it('accepts the tools in either order, since schema order is not a contract', () => {
    const check = checkMinimalIdentity({ ...OBSERVED_MINIMAL, toolNames: ['str_replace_editor', 'bash'] })
    expect(check.exact).toBe(true)
  })
})

describe('fingerprints detect an upstream identity change', () => {
  it('is stable for the same identity', () => {
    expect(fingerprintIdentity(OBSERVED_MINIMAL)).toBe(fingerprintIdentity({ ...OBSERVED_MINIMAL }))
  })

  it('changes when the prompt text changes by one character', () => {
    const drifted = { ...OBSERVED_MINIMAL, promptText: 'You are a helpful software engineer assistant!' }
    expect(fingerprintIdentity(drifted)).not.toBe(fingerprintIdentity(OBSERVED_MINIMAL))
  })

  it('changes when a tool is added', () => {
    const drifted = { ...OBSERVED_MINIMAL, toolNames: ['bash', 'str_replace_editor', 'read'] }
    expect(fingerprintIdentity(drifted)).not.toBe(fingerprintIdentity(OBSERVED_MINIMAL))
  })

  it('does not embed the prompt text, which would make it a second source of truth', () => {
    expect(fingerprintIdentity(OBSERVED_MINIMAL)).not.toContain('helpful software engineer')
  })
})

describe('mode changes are refused after the first request', () => {
  it('allows a change before any model output', () => {
    expect(canChangeMode([{ type: 'user/message' }])).toEqual({ allowed: true })
  })

  it('refuses after the model has answered, and says what to do instead', () => {
    const decision = canChangeMode([{ type: 'assistant/message' }])
    expect(decision.allowed).toBe(false)
    if (!decision.allowed) {
      expect(decision.refusal).toBe('already-requested')
      expect(decision.remedy).toMatch(/fork|new session/i)
    }
  })
})

describe('the phase vocabulary is closed', () => {
  it.each(['minimal-first', 'promoted'])('accepts %s', (phase) => {
    expect(isAdaptivePhase(phase)).toBe(true)
  })

  it.each(['standard', '', undefined, null, 42])('rejects %s', (value) => {
    expect(isAdaptivePhase(value)).toBe(false)
  })
})

describe('the expected Minimal shape matches what was observed live', () => {
  it('names exactly the two official Minimal tools', () => {
    expect([...MINIMAL_TOOL_NAMES].sort()).toEqual(['bash', 'str_replace_editor'])
  })

  it('names the complete-persona section', () => {
    expect(MINIMAL_SECTION_NAME).toBe('deployment:persona')
  })
})
