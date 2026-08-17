import { describe, expect, it } from 'vitest'
import {
  ALLOWED_TOKEN_INCREASE,
  REQUIRED_IMPROVEMENT,
  aggregate,
  evaluatePromotion,
  median,
  type Aggregate,
} from '../src/metrics.ts'
import { NO_METRICS, TASK_CATEGORIES, type RunRecord, type TaskManifest } from '../src/schema.ts'

/**
 * Build a task manifest.
 * @param id - Task id.
 * @param category - Task category.
 * @returns The manifest.
 */
function taskOf(id: string, category: TaskManifest['category'] = 'bug-repair'): TaskManifest {
  return {
    id,
    corpusVersion: 1,
    category,
    prompt: 'do the thing',
    fixture: `fixtures/${id}`,
    platforms: ['darwin'],
    timeoutMs: 600_000,
    allowedScope: ['src'],
    userAuthority: ['model selection'],
    requiresNetwork: false,
    oracle: { command: 'node', args: ['verify.mjs'] },
    rationale: 'exercises the thing',
  }
}

/**
 * Build a run record.
 * @param overrides - Fields to override.
 * @returns The run.
 */
function runOf(overrides: {
  taskId?: string
  configuration?: string
  platform?: NodeJS.Platform
  verifiedSuccess?: boolean | null
  invalidation?: RunRecord['invalidation']
  metrics?: Partial<RunRecord['metrics']>
} = {}): RunRecord {
  return {
    schemaVersion: 1,
    runId: `${overrides.configuration ?? 'daily'}-${overrides.taskId ?? 't1'}-${Math.random()}`,
    taskId: overrides.taskId ?? 't1',
    corpusVersion: 1,
    identity: {
      lane: 'same-model',
      configuration: overrides.configuration ?? 'daily',
      productVersion: '0.1.0',
      model: 'deepseek-chat',
      reasoningEffort: null,
      platform: overrides.platform ?? 'darwin',
      architecture: 'arm64',
      dshVersion: '0.1.0-rc.6',
    },
    repetition: 1,
    order: 0,
    startedAt: '2026-08-15T00:00:00.000Z',
    endedAt: '2026-08-15T00:01:00.000Z',
    verifiedSuccess: overrides.verifiedSuccess ?? true,
    invalidation: overrides.invalidation ?? null,
    metrics: { ...NO_METRICS, unsafeAttempts: 0, ...overrides.metrics },
    oracleEvidence: 'ok',
  }
}

/**
 * Build an aggregate with sane defaults.
 * @param overrides - Fields to override.
 * @returns The aggregate.
 */
function aggregateOf(overrides: Partial<Aggregate> = {}): Aggregate {
  return {
    configuration: 'daily',
    platform: 'darwin',
    validRuns: 9,
    invalidRuns: 0,
    successRate: 0.9,
    resolvedTasks: ['t1', 't2', 't3'],
    byCategory: Object.fromEntries(
      TASK_CATEGORIES.map((category) => [category, { resolved: 5, attempted: 5 }]),
    ) as Aggregate['byCategory'],
    medianTimeMs: 100_000,
    medianModelRequests: 10,
    medianTotalTokens: 50_000,
    unsafeAttempts: 0,
    underRepeated: [],
    ...overrides,
  }
}

/**
 * Build a two-platform comparison from daily/adaptive overrides.
 * @param adaptive - Adaptive-side overrides applied on both platforms.
 * @param daily - Daily-side overrides applied on both platforms.
 * @returns The comparison.
 */
function comparisonOf(
  adaptive: Partial<Aggregate>,
  daily: Partial<Aggregate> = {},
): Partial<Record<NodeJS.Platform, { daily: Aggregate, adaptive: Aggregate }>> {
  const build = (platform: NodeJS.Platform) => ({
    daily: aggregateOf({ ...daily, platform, configuration: 'daily' }),
    adaptive: aggregateOf({ ...adaptive, platform, configuration: 'adaptive' }),
  })
  return { darwin: build('darwin'), win32: build('win32') }
}

const BOTH_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32']

describe('a median refuses to invent a value it has no sample for', () => {
  it('returns null for an empty sample rather than zero', () => {
    // Zero would flow into a comparison as "instantaneous", which is the exact
    // way an unmeasured configuration wins a benchmark it never ran.
    expect(median([])).toBeNull()
  })

  it('returns null when every measurement is absent', () => {
    expect(median([null, null])).toBeNull()
  })

  it('ignores absent measurements rather than treating them as zero', () => {
    expect(median([10, null, 30])).toBe(20)
  })

  it('averages the middle pair for an even sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
})

describe('aggregation separates invalid runs from failures', () => {
  it('excludes invalid runs from the success rate', () => {
    const runs = [
      runOf({ verifiedSuccess: true }),
      runOf({ verifiedSuccess: null, invalidation: { cause: 'rate-limit', detail: '429' } }),
    ]
    const result = aggregate(runs, [taskOf('t1')])
    expect(result.successRate).toBe(1)
    expect(result.invalidRuns).toBe(1)
    expect(result.validRuns).toBe(1)
  })

  it('reports a null success rate when nothing valid ran', () => {
    const runs = [runOf({ verifiedSuccess: null, invalidation: { cause: 'authentication', detail: 'no key' } })]
    expect(aggregate(runs, [taskOf('t1')]).successRate).toBeNull()
  })

  it('counts a task as resolved only when every valid run verified', () => {
    const runs = [
      runOf({ taskId: 't1', verifiedSuccess: true }),
      runOf({ taskId: 't1', verifiedSuccess: false }),
      runOf({ taskId: 't1', verifiedSuccess: true }),
    ]
    expect(aggregate(runs, [taskOf('t1')]).resolvedTasks).toEqual([])
  })

  it('flags tasks that ran fewer than the required repetitions', () => {
    const runs = [runOf({ taskId: 't1' }), runOf({ taskId: 't1' })]
    expect(aggregate(runs, [taskOf('t1')]).underRepeated).toEqual(['t1'])
  })

  it('reports unsafe attempts as null when no run measured them', () => {
    const runs = [runOf({ metrics: { unsafeAttempts: null } })]
    expect(aggregate(runs, [taskOf('t1')]).unsafeAttempts).toBeNull()
  })
})

describe('promotion refuses to decide without the evidence the rule names', () => {
  it('is undecided when one platform has no results', () => {
    const verdict = evaluatePromotion({ darwin: comparisonOf({}).darwin! }, BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('insufficient-evidence')
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing.join()).toMatch(/win32/)
    }
  })

  it('is undecided when the deterministic suite did not pass on a platform', () => {
    const verdict = evaluatePromotion(comparisonOf({}), ['darwin'])
    expect(verdict.outcome).toBe('insufficient-evidence')
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing.join()).toMatch(/deterministic suite unrun or failed on win32/)
    }
  })

  it('is undecided rather than failing when tokens were never measured', () => {
    // "We did not measure it" and "it got worse" are different statements, and
    // collapsing them would let an unmeasured run read as a decided one.
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 50_000, medianTotalTokens: null }, { medianTotalTokens: null }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('insufficient-evidence')
  })

  it('is undecided when a task ran below the repetition floor', () => {
    const verdict = evaluatePromotion(comparisonOf({ underRepeated: ['t7'] }), BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('insufficient-evidence')
  })
})

describe('a missing platform and a missing configuration read differently', () => {
  // The report said `no results for darwin` while a full darwin run sat in the
  // same file. The two states need different actions — run the platform, versus
  // add the adaptive configuration to a platform that already ran — and
  // collapsing them sent a reader hunting for data that was never absent.
  it('says the platform never ran when it never ran', () => {
    const verdict = evaluatePromotion({ win32: comparisonOf({}).win32! }, BOTH_PLATFORMS, ['win32'])
    expect(verdict.outcome).toBe('insufficient-evidence')
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing).toContain('no results for darwin')
    }
  })

  it('says the configuration is missing when the platform has results', () => {
    const verdict = evaluatePromotion({ win32: comparisonOf({}).win32! }, BOTH_PLATFORMS, ['win32', 'darwin'])
    expect(verdict.outcome).toBe('insufficient-evidence')
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing).toContain(
        'darwin has results, but no adaptive configuration was evaluated against daily')
      expect(verdict.missing.join()).not.toMatch(/no results for darwin/)
    }
  })

  it('defaults to the stricter reading when the caller supplies no run record', () => {
    // An omitted argument must not silently claim a platform has results.
    const verdict = evaluatePromotion({ win32: comparisonOf({}).win32! }, BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('insufficient-evidence')
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing).toContain('no results for darwin')
    }
  })
})

describe('promotion fails on each condition the rule names', () => {
  it('fails on a verified-success regression', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ successRate: 0.8, medianTimeMs: 50_000 }, { successRate: 0.9 }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('fail')
    if (verdict.outcome === 'fail') expect(verdict.failures.join()).toMatch(/verified success regressed/)
  })

  it('fails when a category loses more than one resolved task', () => {
    const byCategory = Object.fromEntries(
      TASK_CATEGORIES.map((category) => [
        category,
        { resolved: category === 'refactoring' ? 3 : 5, attempted: 5 },
      ]),
    ) as Aggregate['byCategory']
    const verdict = evaluatePromotion(comparisonOf({ byCategory, medianTimeMs: 50_000 }), BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('fail')
    if (verdict.outcome === 'fail') expect(verdict.failures.join()).toMatch(/refactoring lost 2/)
  })

  it('tolerates a single lost task in a category, which the rule allows', () => {
    const byCategory = Object.fromEntries(
      TASK_CATEGORIES.map((category) => [
        category,
        { resolved: category === 'refactoring' ? 4 : 5, attempted: 5 },
      ]),
    ) as Aggregate['byCategory']
    const verdict = evaluatePromotion(comparisonOf({ byCategory, medianTimeMs: 50_000 }), BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('pass')
  })

  it('fails when unsafe attempts increase, even with a large speed gain', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ unsafeAttempts: 1, medianTimeMs: 10_000 }, { unsafeAttempts: 0 }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('fail')
    if (verdict.outcome === 'fail') expect(verdict.failures.join()).toMatch(/unsafe or unauthorized attempts rose/)
  })

  it('fails when the improvement is below the required threshold', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 95_000, medianModelRequests: 10 }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('fail')
    if (verdict.outcome === 'fail') expect(verdict.failures.join()).toMatch(/below the required/)
  })

  it('fails when tokens rise past the allowed increase despite a speed gain', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 50_000, medianTotalTokens: 60_000 }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('fail')
    if (verdict.outcome === 'fail') expect(verdict.failures.join()).toMatch(/median total tokens rose/)
  })

  it('fails when only one platform improves, since platforms are judged independently', () => {
    const comparison = comparisonOf({ medianTimeMs: 50_000 })
    comparison.win32 = {
      daily: aggregateOf({ platform: 'win32' }),
      adaptive: aggregateOf({ platform: 'win32', configuration: 'adaptive', medianTimeMs: 99_000 }),
    }
    const verdict = evaluatePromotion(comparison, BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('fail')
    if (verdict.outcome === 'fail') expect(verdict.failures.join()).toMatch(/win32/)
  })
})

describe('promotion passes only on the complete case', () => {
  it('passes when every condition holds on both platforms', () => {
    const verdict = evaluatePromotion(comparisonOf({ medianTimeMs: 80_000 }), BOTH_PLATFORMS)
    expect(verdict.outcome).toBe('pass')
    if (verdict.outcome === 'pass') {
      expect(verdict.gains).toHaveLength(2)
      expect(verdict.gains.join()).toMatch(/median time/)
    }
  })

  it('accepts a model-request improvement when time did not improve', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 100_000, medianModelRequests: 8 }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('pass')
    if (verdict.outcome === 'pass') expect(verdict.gains.join()).toMatch(/median model requests/)
  })

  it('accepts a token increase exactly at the allowed ceiling', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 80_000, medianTotalTokens: 50_000 * (1 + ALLOWED_TOKEN_INCREASE) }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('pass')
  })

  it('accepts an improvement exactly at the required threshold', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 100_000 * (1 - REQUIRED_IMPROVEMENT) }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('pass')
  })
})

describe('boundary cases decide on the measurement, not on float representation', () => {
  it.each([
    { baseline: 3, label: 'a small sample where the ratio is inexact' },
    { baseline: 7, label: 'a prime baseline' },
    { baseline: 123_457, label: 'a large odd baseline' },
  ])('accepts an exactly-at-threshold improvement for $label', ({ baseline }) => {
    const verdict = evaluatePromotion(
      comparisonOf(
        { medianTimeMs: baseline * (1 - REQUIRED_IMPROVEMENT), medianTotalTokens: baseline },
        { medianTimeMs: baseline, medianTotalTokens: baseline },
      ),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('pass')
  })

  it.each([3, 7, 123_457])('accepts an exactly-at-ceiling token increase for baseline %d', (baseline) => {
    const verdict = evaluatePromotion(
      comparisonOf(
        { medianTimeMs: 50_000, medianTotalTokens: baseline * (1 + ALLOWED_TOKEN_INCREASE) },
        { medianTotalTokens: baseline },
      ),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('pass')
  })

  it('still rejects one unit past the ceiling', () => {
    const verdict = evaluatePromotion(
      comparisonOf({ medianTimeMs: 50_000, medianTotalTokens: 55_001 }, { medianTotalTokens: 50_000 }),
      BOTH_PLATFORMS,
    )
    expect(verdict.outcome).toBe('fail')
  })
})

describe('an undecided verdict distinguishes missing platform from missing configuration', () => {
  it('says a platform has results when adaptive simply was not evaluated', () => {
    // The defect this replaces reported "no results for darwin" against a
    // report that contained darwin results, sending a reader to look for data
    // that was already there.
    const verdict = evaluatePromotion({}, BOTH_PLATFORMS, ['darwin'])
    expect(verdict.outcome).toBe('insufficient-evidence')
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing.join()).toMatch(/darwin has results, but no adaptive configuration/)
      expect(verdict.missing.join()).toMatch(/no results for win32/)
    }
  })

  it('still says no results when the platform truly ran nothing', () => {
    const verdict = evaluatePromotion({}, BOTH_PLATFORMS, [])
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing.join()).toMatch(/no results for darwin/)
    }
  })

  it('defaults to the old wording when the caller reports no platform list', () => {
    const verdict = evaluatePromotion({}, BOTH_PLATFORMS)
    if (verdict.outcome === 'insufficient-evidence') {
      expect(verdict.missing.join()).toMatch(/no results for darwin/)
    }
  })
})
