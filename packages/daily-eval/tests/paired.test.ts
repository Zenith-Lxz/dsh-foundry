import { describe, expect, it } from 'vitest'
import {
  describeInterval,
  pairOutcomes,
  pairedSuccessInterval,
  provenWorse,
  seededRandom,
  type PairedOutcome,
} from '../src/paired.ts'

/**
 * Build paired outcomes from two verdict strings.
 * @param baseline - One character per task: `1` verified, `0` did not.
 * @param candidate - Same, for the candidate.
 * @returns The pairs.
 */
function pairsOf(baseline: string, candidate: string): PairedOutcome[] {
  return [...baseline].map((flag, index) => ({
    taskId: `t${index}`,
    baseline: flag === '1',
    candidate: candidate[index] === '1',
  }))
}

describe('the bootstrap is deterministic', () => {
  it('gives the same interval for the same data', () => {
    const pairs = pairsOf('1101101110', '1111101110')
    expect(pairedSuccessInterval(pairs, 2000)).toEqual(pairedSuccessInterval(pairs, 2000))
  })

  it('produces a repeatable generator sequence', () => {
    const first = seededRandom(7)
    const second = seededRandom(7)
    expect([first(), first(), first()]).toEqual([second(), second(), second()])
  })

  it('stays inside the unit interval', () => {
    const random = seededRandom(3)
    for (let index = 0; index < 200; index += 1) {
      const value = random()
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThan(1)
    }
  })
})

describe('a one-task difference is reported as inconclusive', () => {
  it('produces an interval that includes zero', () => {
    // 40 tasks, candidate resolves one fewer. A median comparison calls this a
    // regression; the paired interval includes zero, so the data cannot tell
    // them apart. The upper bound reaches exactly zero rather than crossing it,
    // because no resample can make a one-sided loss look like a gain.
    const baseline = '1'.repeat(37) + '000'
    const candidate = '1'.repeat(36) + '0000'
    const interval = pairedSuccessInterval(pairsOf(baseline, candidate), 4000)!
    expect(interval.lower).toBeLessThan(0)
    expect(interval.upper).toBeGreaterThanOrEqual(0)
    expect(provenWorse(interval)).toBe(false)
  })

  it('separates "includes zero" from "proven worse" at the boundary', () => {
    // An interval whose upper bound is exactly zero is inconclusive, not a
    // regression; treating `<= 0` as harm would fail a candidate the data does
    // not distinguish from the baseline.
    expect(provenWorse({ estimate: -0.025, lower: -0.075, upper: 0, pairs: 40 })).toBe(false)
    expect(provenWorse({ estimate: -0.05, lower: -0.1, upper: -0.001, pairs: 40 })).toBe(true)
  })
})

describe('a consistent regression is detected', () => {
  it('places the whole interval below zero', () => {
    const interval = pairedSuccessInterval(pairsOf('1'.repeat(40), '0'.repeat(40)), 4000)!
    expect(interval.upper).toBeLessThan(0)
    expect(provenWorse(interval)).toBe(true)
  })
})

describe('an improvement is not mistaken for harm', () => {
  it('reports a positive estimate and is not proven worse', () => {
    const interval = pairedSuccessInterval(pairsOf('0'.repeat(40), '1'.repeat(40)), 4000)!
    expect(interval.estimate).toBe(1)
    expect(provenWorse(interval)).toBe(false)
  })
})

describe('identical configurations are indistinguishable', () => {
  it('estimates zero difference', () => {
    const interval = pairedSuccessInterval(pairsOf('10110', '10110'), 2000)!
    expect(interval.estimate).toBe(0)
    expect(interval.lower).toBe(0)
    expect(interval.upper).toBe(0)
  })
})

describe('absent data is absent, not neutral', () => {
  it('returns null for no pairs', () => {
    expect(pairedSuccessInterval([])).toBeNull()
  })

  it('is not treated as proof of harm', () => {
    expect(provenWorse(null)).toBe(false)
  })

  it('renders as unmeasured rather than as zero', () => {
    expect(describeInterval(null)).toMatch(/not measured/)
  })
})

describe('pairing reports what it could not pair', () => {
  it('pairs every task both sides attempted', () => {
    const { pairs } = pairOutcomes(['a', 'b'], ['b', 'c'], ['a', 'b', 'c'])
    expect(pairs).toEqual([
      { taskId: 'a', baseline: true, candidate: false },
      { taskId: 'b', baseline: true, candidate: true },
      { taskId: 'c', baseline: false, candidate: true },
    ])
  })

  it('names a resolved task missing from the corpus rather than dropping it', () => {
    // Silently dropping it would shrink the denominator without saying so.
    const { unpaired } = pairOutcomes(['a', 'ghost'], ['a'], ['a'])
    expect(unpaired).toEqual(['ghost'])
  })

  it('reports nothing unpaired in the ordinary case', () => {
    expect(pairOutcomes(['a'], ['a'], ['a']).unpaired).toEqual([])
  })
})

describe('the rendered interval carries its sample size', () => {
  it('states the paired task count', () => {
    const text = describeInterval(pairedSuccessInterval(pairsOf('110', '111'), 1000))
    expect(text).toMatch(/over 3 paired tasks/)
    expect(text).toMatch(/95% CI/)
  })
})
