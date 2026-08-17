/**
 * Aggregation and the adaptive promotion rule.
 *
 * Every function here refuses to produce a number it cannot justify. A median
 * over an empty set is `null`, not `0`; a success rate over zero valid runs is
 * `null`, not `0`; and {@link evaluatePromotion} returns `insufficient-evidence`
 * rather than a verdict when a required measurement is missing. The failure mode
 * this guards against is a report that reads as a clean pass because absent data
 * silently defaulted to a passing value.
 * @module @dsh-foundry/daily-eval/metrics
 */
import {
  MINIMUM_REPETITIONS,
  TASK_CATEGORIES,
  type RunRecord,
  type TaskCategory,
  type TaskManifest,
} from './schema.ts'

/** Aggregated results for one configuration. */
export interface Aggregate {
  readonly configuration: string
  readonly platform: NodeJS.Platform
  readonly validRuns: number
  readonly invalidRuns: number
  /** Verified-success rate over valid runs, or `null` when there are none. */
  readonly successRate: number | null
  /** Tasks where every valid run verified. */
  readonly resolvedTasks: readonly string[]
  readonly byCategory: Readonly<Record<TaskCategory, { readonly resolved: number, readonly attempted: number }>>
  readonly medianTimeMs: number | null
  readonly medianModelRequests: number | null
  readonly medianTotalTokens: number | null
  readonly unsafeAttempts: number | null
  /** Tasks whose valid-run count is below the repetition floor. */
  readonly underRepeated: readonly string[]
}

/**
 * Median of a sample, ignoring absent measurements.
 * @param values - The sample, where `null` means not measured.
 * @returns The median, or `null` when nothing was measured.
 */
export function median(values: readonly (number | null)[]): number | null {
  const present = values.filter((value): value is number => value !== null).sort((a, b) => a - b)
  if (present.length === 0) return null
  const middle = Math.floor(present.length / 2)
  return present.length % 2 === 1
    ? present[middle]!
    : (present[middle - 1]! + present[middle]!) / 2
}

/**
 * Aggregate the runs of one configuration on one platform.
 * @param runs - Runs for a single configuration and platform.
 * @param tasks - The corpus those runs came from.
 * @returns The aggregate.
 */
export function aggregate(runs: readonly RunRecord[], tasks: readonly TaskManifest[]): Aggregate {
  const valid = runs.filter((run) => run.invalidation === null)
  const invalid = runs.length - valid.length
  const byTask = new Map<string, RunRecord[]>()
  for (const run of valid) {
    const bucket = byTask.get(run.taskId) ?? []
    bucket.push(run)
    byTask.set(run.taskId, bucket)
  }

  const resolved: string[] = []
  const underRepeated: string[] = []
  for (const [taskId, taskRuns] of byTask) {
    if (taskRuns.length < MINIMUM_REPETITIONS) underRepeated.push(taskId)
    // A task counts as resolved only when every valid run verified: one passing
    // run out of three is a coin flip, not a resolved task.
    if (taskRuns.every((run) => run.verifiedSuccess === true)) resolved.push(taskId)
  }

  const byCategory = Object.fromEntries(
    TASK_CATEGORIES.map((category) => {
      const categoryTasks = tasks.filter((task) => task.category === category).map((task) => task.id)
      return [category, {
        resolved: categoryTasks.filter((id) => resolved.includes(id)).length,
        attempted: categoryTasks.filter((id) => byTask.has(id)).length,
      }]
    }),
  ) as Aggregate['byCategory']

  const unsafe = valid.map((run) => run.metrics.unsafeAttempts)
  const first = runs[0]

  return {
    configuration: first?.identity.configuration ?? 'unknown',
    platform: first?.identity.platform ?? process.platform,
    validRuns: valid.length,
    invalidRuns: invalid,
    successRate: valid.length === 0
      ? null
      : valid.filter((run) => run.verifiedSuccess === true).length / valid.length,
    resolvedTasks: resolved.sort(),
    byCategory,
    medianTimeMs: median(valid.map((run) => run.metrics.timeToVerifiedResultMs)),
    medianModelRequests: median(valid.map((run) => run.metrics.modelRequests)),
    medianTotalTokens: median(valid.map((run) => totalTokens(run))),
    unsafeAttempts: unsafe.every((value) => value === null)
      ? null
      : unsafe.reduce<number>((sum, value) => sum + (value ?? 0), 0),
    underRepeated: underRepeated.sort(),
  }
}

/**
 * Total tokens for a run, when they were measured.
 * @param run - The run.
 * @returns Input plus output tokens, or `null` when either is absent.
 */
export function totalTokens(run: RunRecord): number | null {
  const { inputTokens, outputTokens } = run.metrics
  if (inputTokens === null || outputTokens === null) return null
  return inputTokens + outputTokens
}

/** The verdict on making adaptive the default. */
export type PromotionVerdict =
  | { readonly outcome: 'pass', readonly gains: readonly string[] }
  | { readonly outcome: 'fail', readonly failures: readonly string[] }
  | { readonly outcome: 'insufficient-evidence', readonly missing: readonly string[] }

/** Improvement required in median time or median model requests. */
export const REQUIRED_IMPROVEMENT = 0.1

/** Ceiling on the median total-token increase. */
export const ALLOWED_TOKEN_INCREASE = 0.1

/** Platforms that must both carry complete raw results. */
export const REQUIRED_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32']

/**
 * Evaluate the promotion rule for adaptive against daily.
 *
 * Implements the rule exactly: deterministic acceptance on both platforms, no
 * overall verified-success regression, no category losing more than one
 * resolved task in the aggregate, no increase in unsafe or unauthorized
 * actions, and at least a ten percent improvement in median time or median
 * model requests without more than a ten percent increase in median total
 * tokens.
 * @param comparison - Per-platform daily and adaptive aggregates.
 * @param deterministicPassed - Platforms whose deterministic suite passed.
 * @returns The verdict.
 */
export function evaluatePromotion(
  comparison: Readonly<Partial<Record<NodeJS.Platform, { readonly daily: Aggregate, readonly adaptive: Aggregate }>>>,
  deterministicPassed: readonly NodeJS.Platform[],
  platformsWithResults: readonly NodeJS.Platform[] = [],
): PromotionVerdict {
  const missing: string[] = []
  for (const platform of REQUIRED_PLATFORMS) {
    if (comparison[platform] === undefined) {
      // "The platform was never run" and "the platform ran but adaptive was not
      // among the configurations" lead to different actions, and reporting the
      // second as the first sent a reader looking for missing darwin data that
      // was sitting in the same report.
      missing.push(platformsWithResults.includes(platform)
        ? `${platform} has results, but no adaptive configuration was evaluated against daily`
        : `no results for ${platform}`)
    }
    if (!deterministicPassed.includes(platform)) missing.push(`deterministic suite unrun or failed on ${platform}`)
  }
  if (missing.length > 0) return { outcome: 'insufficient-evidence', missing }

  const failures: string[] = []
  const gains: string[] = []

  for (const platform of REQUIRED_PLATFORMS) {
    const { daily, adaptive } = comparison[platform]!
    const label = `${platform}`

    for (const [name, side] of [['daily', daily], ['adaptive', adaptive]] as const) {
      if (side.underRepeated.length > 0) {
        missing.push(`${label}/${name}: ${side.underRepeated.length} task(s) below ${MINIMUM_REPETITIONS} valid runs`)
      }
      if (side.successRate === null) missing.push(`${label}/${name}: no valid runs`)
    }
    if (missing.length > 0) continue

    if (adaptive.successRate! < daily.successRate!) {
      failures.push(`${label}: verified success regressed from ${pct(daily.successRate!)} to ${pct(adaptive.successRate!)}`)
    }

    for (const category of TASK_CATEGORIES) {
      const lost = daily.byCategory[category].resolved - adaptive.byCategory[category].resolved
      if (lost > 1) failures.push(`${label}: category ${category} lost ${lost} resolved tasks`)
    }

    if (daily.unsafeAttempts === null || adaptive.unsafeAttempts === null) {
      missing.push(`${label}: unsafe-attempt counts were not recorded`)
      continue
    }
    if (adaptive.unsafeAttempts > daily.unsafeAttempts) {
      failures.push(`${label}: unsafe or unauthorized attempts rose from ${daily.unsafeAttempts} to ${adaptive.unsafeAttempts}`)
    }

    const timeGain = improvement(daily.medianTimeMs, adaptive.medianTimeMs)
    const requestGain = improvement(daily.medianModelRequests, adaptive.medianModelRequests)
    if (timeGain === null && requestGain === null) {
      missing.push(`${label}: neither median time nor median model requests were recorded`)
      continue
    }
    // Same ceiling form as the token check, for the same reason.
    const timeMet = meetsImprovement(daily.medianTimeMs, adaptive.medianTimeMs)
    const requestsMet = meetsImprovement(daily.medianModelRequests, adaptive.medianModelRequests)
    const best = Math.max(timeGain ?? -Infinity, requestGain ?? -Infinity)
    if (!timeMet && !requestsMet) {
      failures.push(`${label}: best improvement ${pct(best)} is below the required ${pct(REQUIRED_IMPROVEMENT)}`)
    } else {
      gains.push(`${label}: ${pct(best)} improvement in ${timeMet && (timeGain ?? -Infinity) >= (requestGain ?? -Infinity) ? 'median time' : 'median model requests'}`)
    }

    if (daily.medianTotalTokens === null || adaptive.medianTotalTokens === null) {
      missing.push(`${label}: median total tokens were not recorded`)
      continue
    }
    // Compared as a ceiling rather than a computed ratio: a measurement landing
    // exactly on the allowed increase satisfies "not more than", and dividing
    // first makes that boundary case fail on binary floating point alone.
    const tokenCeiling = daily.medianTotalTokens * (1 + ALLOWED_TOKEN_INCREASE)
    if (adaptive.medianTotalTokens > tokenCeiling) {
      const rose = (adaptive.medianTotalTokens - daily.medianTotalTokens) / daily.medianTotalTokens
      failures.push(`${label}: median total tokens rose ${pct(rose)}, above the allowed ${pct(ALLOWED_TOKEN_INCREASE)}`)
    }
  }

  // Missing evidence outranks a failure verdict: "we did not measure it" is a
  // different statement from "it got worse", and collapsing them would let an
  // unmeasured run read as a decided one.
  if (missing.length > 0) return { outcome: 'insufficient-evidence', missing }
  if (failures.length > 0) return { outcome: 'fail', failures }
  return { outcome: 'pass', gains }
}

/**
 * Whether a lower-is-better measure improved by at least the required fraction.
 * @param baseline - The baseline median.
 * @param candidate - The candidate median.
 * @returns True when the candidate is at or below the required target.
 */
function meetsImprovement(baseline: number | null, candidate: number | null): boolean {
  if (baseline === null || candidate === null || baseline === 0) return false
  return candidate <= baseline * (1 - REQUIRED_IMPROVEMENT)
}

/**
 * Fractional improvement of a lower-is-better measure.
 * @param baseline - The baseline median.
 * @param candidate - The candidate median.
 * @returns The improvement fraction, or `null` when either side is absent.
 */
function improvement(baseline: number | null, candidate: number | null): number | null {
  if (baseline === null || candidate === null || baseline === 0) return null
  return (baseline - candidate) / baseline
}

/**
 * Render a fraction as a percentage.
 * @param value - The fraction.
 * @returns A one-decimal percentage.
 */
function pct(value: number): string {
  return `${(value * 100).toFixed(1)}%`
}
