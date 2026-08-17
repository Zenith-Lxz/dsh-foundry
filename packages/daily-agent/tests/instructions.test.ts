import { describe, expect, it } from 'vitest'
import {
  DAILY_INSTRUCTIONS,
  DAILY_SECTION_TOKEN_BUDGET,
  DAILY_VARIANTS,
  estimateTokens,
  instructionsFor,
} from '../src/instructions.ts'


describe('the instruction set is comparable, not decided by judgement', () => {
  it('offers a lean variant without the boundary-testing paragraph', () => {
    expect(DAILY_VARIANTS.lean).not.toMatch(/test the boundaries rather than the happy path/)
  })

  it('keeps everything else identical between variants', () => {
    // Only the paragraph under test may differ, or the comparison measures
    // two unrelated rewrites instead of one decision.
    const removed = DAILY_VARIANTS.full.replace(DAILY_VARIANTS.lean.split('\n\n').join('\n\n'), '')
    expect(DAILY_VARIANTS.lean.length).toBeLessThan(DAILY_VARIANTS.full.length)
    for (const paragraph of DAILY_VARIANTS.lean.split('\n\n')) {
      expect(DAILY_VARIANTS.full).toContain(paragraph)
    }
    expect(removed.length).toBeGreaterThan(0)
  })

  it('costs meaningfully fewer standing tokens', () => {
    expect(estimateTokens(DAILY_VARIANTS.lean)).toBeLessThan(estimateTokens(DAILY_VARIANTS.full))
  })

  it('defaults to lean, which is what the controlled sweep supported', () => {
    // full measured 89.2% against 92.5% for the official baseline; lean reached
    // 91.7% at baseline cost.
    expect(DAILY_INSTRUCTIONS).toBe(DAILY_VARIANTS.lean)
  })

  it('falls back to the default for an unknown variant', () => {
    expect(instructionsFor('nonsense')).toBe(DAILY_INSTRUCTIONS)
    expect(instructionsFor(undefined)).toBe(DAILY_INSTRUCTIONS)
  })

  it('both variants stay within the standing budget', () => {
    for (const text of Object.values(DAILY_VARIANTS)) {
      expect(estimateTokens(text)).toBeLessThanOrEqual(DAILY_SECTION_TOKEN_BUDGET)
    }
  })
})
