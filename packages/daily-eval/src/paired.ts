/**
 * Paired comparison between two configurations.
 *
 * Comparing two medians answers "which number is larger", which is not the
 * question. Every task in this corpus is run by both configurations, so the
 * runs pair up, and a paired analysis removes the variance that comes from
 * tasks simply being of different difficulty. Two configurations differing by
 * one resolved task out of forty is noise; the interval says so, a median
 * comparison does not.
 *
 * Bootstrap rather than a closed form: success is a paired proportion and the
 * timing samples are small and skewed, so a normal approximation would state a
 * precision the data does not have.
 * @module @dsh-foundry/daily-eval/paired
 */

/** One task's outcome under both configurations. */
export interface PairedOutcome {
  readonly taskId: string
  /** Whether the baseline verified. */
  readonly baseline: boolean
  /** Whether the candidate verified. */
  readonly candidate: boolean
}

/** A confidence interval for a difference. */
export interface Interval {
  /** Point estimate: candidate minus baseline. */
  readonly estimate: number
  readonly lower: number
  readonly upper: number
  /** Pairs the interval was computed from. */
  readonly pairs: number
}

/** Bootstrap resamples. Enough for a stable 95% interval at this corpus size. */
export const BOOTSTRAP_SAMPLES = 10_000

/**
 * A small deterministic generator.
 *
 * Seeded so a report regenerated from the same raw results states the same
 * interval. A bootstrap that moves between runs of the same data would make
 * the promotion verdict depend on when it was computed.
 * @param seed - Starting state.
 * @returns A function yielding values in `[0, 1)`.
 */
export function seededRandom(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    // xorshift32: small, deterministic, and adequate for resampling indices.
    state ^= state << 13
    state ^= state >>> 17
    state ^= state << 5
    state >>>= 0
    return state / 0x1_0000_0000
  }
}

/**
 * Bootstrap a 95% confidence interval for the paired success-rate difference.
 * @param outcomes - One entry per task, both configurations' verdicts.
 * @param samples - Resample count.
 * @param seed - Generator seed.
 * @returns The interval, or `null` when there are no pairs.
 */
export function pairedSuccessInterval(
  outcomes: readonly PairedOutcome[],
  samples = BOOTSTRAP_SAMPLES,
  seed = 20_260_817,
): Interval | null {
  if (outcomes.length === 0) return null
  const differences = outcomes.map((outcome) => Number(outcome.candidate) - Number(outcome.baseline))
  const mean = (values: readonly number[]): number =>
    values.reduce((sum, value) => sum + value, 0) / values.length

  const random = seededRandom(seed)
  const resampled: number[] = []
  for (let sample = 0; sample < samples; sample += 1) {
    let total = 0
    for (let index = 0; index < differences.length; index += 1) {
      total += differences[Math.floor(random() * differences.length)]!
    }
    resampled.push(total / differences.length)
  }
  resampled.sort((left, right) => left - right)

  return {
    estimate: mean(differences),
    lower: resampled[Math.floor(0.025 * samples)]!,
    upper: resampled[Math.floor(0.975 * samples)]!,
    pairs: outcomes.length,
  }
}

/**
 * Whether an interval proves the candidate is worse.
 *
 * The promotion rule asks for the absence of proof of harm, not proof of
 * improvement: an interval straddling zero means the data does not distinguish
 * them, which is a pass on this condition. Only an interval lying entirely
 * below zero is evidence of a regression.
 * @param interval - The paired interval, or `null` when unmeasured.
 * @returns True when the candidate is proven worse.
 */
export function provenWorse(interval: Interval | null): boolean {
  return interval !== null && interval.upper < 0
}

/**
 * Render an interval for a report.
 * @param interval - The interval, or `null`.
 * @returns A readable summary.
 */
export function describeInterval(interval: Interval | null): string {
  if (interval === null) return 'not measured (no paired runs)'
  const percent = (value: number): string => `${(value * 100).toFixed(1)}pp`
  return `${percent(interval.estimate)} [95% CI ${percent(interval.lower)}, ${percent(interval.upper)}] over ${interval.pairs} paired tasks`
}

/**
 * Pair two configurations' per-task verdicts.
 *
 * A task counts as resolved for a configuration only when every one of its
 * valid runs verified, matching how `aggregate` reports resolved tasks. Tasks
 * missing from either side are excluded and reported, because an unpaired task
 * cannot contribute to a paired comparison and silently dropping it would
 * shrink the denominator without saying so.
 * @param baseline - Task ids the baseline resolved.
 * @param candidate - Task ids the candidate resolved.
 * @param allTasks - Every task both configurations attempted.
 * @returns The pairs and the ids that could not be paired.
 */
export function pairOutcomes(
  baseline: readonly string[],
  candidate: readonly string[],
  allTasks: readonly string[],
): { readonly pairs: PairedOutcome[], readonly unpaired: readonly string[] } {
  const baselineSet = new Set(baseline)
  const candidateSet = new Set(candidate)
  const pairs = allTasks.map((taskId) => ({
    taskId,
    baseline: baselineSet.has(taskId),
    candidate: candidateSet.has(taskId),
  }))
  const known = new Set(allTasks)
  const unpaired = [...new Set([...baseline, ...candidate])].filter((taskId) => !known.has(taskId))
  return { pairs, unpaired: unpaired.sort() }
}
