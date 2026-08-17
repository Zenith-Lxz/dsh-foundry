/**
 * Evaluation reports, human- and machine-readable.
 *
 * A report always states its own limits. The rule this module enforces is that
 * no comparative sentence is emitted unless the evidence behind it exists: an
 * unrun model evaluation says *unrun*, a cross-lane pairing carries the warning
 * that the native-product lane attributes nothing to composition, and an
 * expired claim is printed as expired rather than dropped — a silently removed
 * claim looks the same as one that was never made.
 * @module @dsh-foundry/daily-eval/report
 */
import { aggregate, evaluatePromotion, type Aggregate, type PromotionVerdict } from './metrics.ts'
import {
  EVAL_SCHEMA_VERSION,
  checkCoverage,
  claimIsExpired,
  type ComparisonClaim,
  type ConfigurationIdentity,
  type RunRecord,
  type TaskManifest,
} from './schema.ts'

/** Everything a report is derived from. */
export interface ReportInput {
  readonly corpusVersion: number
  readonly tasks: readonly TaskManifest[]
  readonly runs: readonly RunRecord[]
  /** Platforms whose keyless deterministic suite passed. */
  readonly deterministicPassed: readonly NodeJS.Platform[]
  /** Claims to re-check against the identities present in this run. */
  readonly claims: readonly ComparisonClaim[]
  /** Why the model evaluation did not run, when it did not. */
  readonly modelEvaluationUnrun: string | null
}

/** The machine-readable report. */
export interface EvalReport {
  readonly schemaVersion: number
  readonly corpusVersion: number
  readonly generatedAt: string
  readonly coverageProblems: readonly string[]
  readonly identities: readonly ConfigurationIdentity[]
  readonly aggregates: readonly Aggregate[]
  readonly invalidRuns: readonly { readonly runId: string, readonly cause: string, readonly detail: string }[]
  readonly promotion: PromotionVerdict
  readonly claims: readonly { readonly statement: string, readonly expired: string | null }[]
  readonly limitations: readonly string[]
  readonly modelEvaluationUnrun: string | null
}

/**
 * Build the machine-readable report.
 * @param input - Corpus, runs, and claims.
 * @param now - Generation timestamp.
 * @returns The report.
 */
export function buildReport(input: ReportInput, now = new Date()): EvalReport {
  const identities = distinctIdentities(input.runs)
  const aggregates = groupRuns(input.runs).map(([, runs]) => aggregate(runs, input.tasks))

  const comparison: Partial<Record<NodeJS.Platform, { daily: Aggregate, adaptive: Aggregate }>> = {}
  for (const platform of new Set(aggregates.map((entry) => entry.platform))) {
    const daily = aggregates.find((entry) => entry.platform === platform && entry.configuration === 'daily')
    const adaptive = aggregates.find((entry) => entry.platform === platform && entry.configuration === 'adaptive')
    if (daily !== undefined && adaptive !== undefined) comparison[platform] = { daily, adaptive }
  }

  return {
    schemaVersion: EVAL_SCHEMA_VERSION,
    corpusVersion: input.corpusVersion,
    generatedAt: now.toISOString(),
    coverageProblems: checkCoverage(input.tasks),
    identities,
    aggregates,
    invalidRuns: input.runs
      .filter((run) => run.invalidation !== null)
      .map((run) => ({ runId: run.runId, cause: run.invalidation!.cause, detail: run.invalidation!.detail })),
    promotion: evaluatePromotion(
      comparison,
      input.deterministicPassed,
      [...new Set(aggregates.map((entry) => entry.platform))],
    ),
    claims: input.claims.map((claim) => ({
      statement: claim.statement,
      expired: claimIsExpired(claim, identities, input.corpusVersion),
    })),
    limitations: deriveLimitations(input, aggregates),
    modelEvaluationUnrun: input.modelEvaluationUnrun,
  }
}

/**
 * Render a report as Markdown.
 * @param report - The machine-readable report.
 * @returns Markdown text.
 */
export function renderReport(report: EvalReport): string {
  const lines: string[] = [
    '# Coding evaluation',
    '',
    `corpus version ${report.corpusVersion} · schema ${report.schemaVersion} · generated ${report.generatedAt}`,
    '',
  ]

  if (report.modelEvaluationUnrun !== null) {
    lines.push(
      '## Model evaluation: UNRUN',
      '',
      report.modelEvaluationUnrun,
      '',
      'The deterministic mechanics suite below is independent of this and did run.',
      '',
    )
  }

  if (report.coverageProblems.length > 0) {
    lines.push('## Corpus coverage is incomplete', '', ...report.coverageProblems.map((problem) => `- ${problem}`), '')
  }

  const sameModel = report.aggregates.filter((entry) => isLane(report, entry, 'same-model'))
  const native = report.aggregates.filter((entry) => isLane(report, entry, 'native-product'))

  if (sameModel.length > 0) {
    lines.push(
      '## Same-model lane',
      '',
      'Identical model route, prompt, permissions, workspace revision, platform, timeout, and oracle.',
      'Differences here are attributable to composition.',
      '',
      ...table(sameModel),
      '',
    )
  }

  if (native.length > 0) {
    lines.push(
      '## Native-product lane',
      '',
      'Whole products at their own defaults, with different models, prompts, and tooling.',
      '**Differences here are not attributable to composition** and must not be read as a Harness result.',
      '',
      ...table(native),
      '',
    )
  }

  lines.push('## Adaptive promotion', '')
  if (report.promotion.outcome === 'pass') {
    lines.push('Every promotion condition passed:', '', ...report.promotion.gains.map((gain) => `- ${gain}`))
  } else if (report.promotion.outcome === 'fail') {
    lines.push('Promotion FAILED. Daily mode remains the default.', '', ...report.promotion.failures.map((entry) => `- ${entry}`))
  } else {
    lines.push(
      'Promotion is UNDECIDED — the evidence required by the rule does not exist:',
      '',
      ...report.promotion.missing.map((entry) => `- ${entry}`),
      '',
      'Daily mode remains the default. This is not a negative result about adaptive; it is the absence of one.',
    )
  }
  lines.push('')

  if (report.invalidRuns.length > 0) {
    lines.push(
      '## Invalid runs',
      '',
      `${report.invalidRuns.length} run(s) were excluded. These are not agent failures.`,
      '',
      ...report.invalidRuns.map((run) => `- \`${run.runId}\` — ${run.cause}: ${run.detail}`),
      '',
    )
  }

  if (report.claims.length > 0) {
    lines.push('## Comparison claims', '')
    for (const claim of report.claims) {
      lines.push(claim.expired === null ? `- ${claim.statement}` : `- ~~${claim.statement}~~ — EXPIRED: ${claim.expired}`)
    }
    lines.push('')
  }

  lines.push('## Limitations', '', ...report.limitations.map((limit) => `- ${limit}`), '')
  return lines.join('\n')
}

/**
 * Derive the limitations that apply to this report.
 * @param input - The report input.
 * @param aggregates - Computed aggregates.
 * @returns Limitation sentences.
 */
function deriveLimitations(input: ReportInput, aggregates: readonly Aggregate[]): string[] {
  const limitations: string[] = []
  const platforms = new Set(aggregates.map((entry) => entry.platform))
  for (const platform of ['darwin', 'win32'] as const) {
    if (!platforms.has(platform)) {
      limitations.push(`No ${platform} results: behavior on that platform is unevaluated, not equivalent.`)
    }
  }
  const underRepeated = aggregates.flatMap((entry) => entry.underRepeated)
  if (underRepeated.length > 0) {
    limitations.push(`${underRepeated.length} configuration/task pairs ran fewer than the required repetitions; their rates are not stable estimates.`)
  }
  if (aggregates.some((entry) => entry.medianTotalTokens === null)) {
    limitations.push('Token usage was not available for every configuration, so cost comparisons are incomplete.')
  }
  if (input.runs.length === 0) {
    limitations.push('No runs were recorded, so this report describes the corpus only.')
  }
  limitations.push('Oracles verify stated success conditions; they do not assess code quality, maintainability, or review burden.')
  return limitations
}

/**
 * Group runs by configuration and platform.
 * @param runs - All runs.
 * @returns Grouped runs.
 */
function groupRuns(runs: readonly RunRecord[]): [string, RunRecord[]][] {
  const groups = new Map<string, RunRecord[]>()
  for (const run of runs) {
    const key = `${run.identity.platform}/${run.identity.configuration}`
    const bucket = groups.get(key) ?? []
    bucket.push(run)
    groups.set(key, bucket)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

/**
 * Collect the distinct identities present in a run set.
 * @param runs - All runs.
 * @returns Distinct identities.
 */
function distinctIdentities(runs: readonly RunRecord[]): ConfigurationIdentity[] {
  const seen = new Map<string, ConfigurationIdentity>()
  for (const run of runs) {
    seen.set(`${run.identity.lane}/${run.identity.configuration}/${run.identity.platform}`, run.identity)
  }
  return [...seen.values()]
}

/**
 * Decide whether an aggregate belongs to a lane.
 * @param report - The report holding the identities.
 * @param entry - The aggregate.
 * @param lane - The lane to test.
 * @returns True when the aggregate's configuration ran in that lane.
 */
function isLane(report: EvalReport, entry: Aggregate, lane: string): boolean {
  return report.identities.some(
    (identity) => identity.configuration === entry.configuration
      && identity.platform === entry.platform
      && identity.lane === lane,
  )
}

/**
 * Render aggregates as a Markdown table.
 * @param aggregates - Aggregates to render.
 * @returns Table lines.
 */
function table(aggregates: readonly Aggregate[]): string[] {
  const rows = aggregates.map((entry) => [
    entry.configuration,
    entry.platform,
    `${entry.validRuns}${entry.invalidRuns > 0 ? ` (+${entry.invalidRuns} invalid)` : ''}`,
    entry.successRate === null ? 'n/a' : `${(entry.successRate * 100).toFixed(1)}%`,
    entry.medianTimeMs === null ? 'n/a' : `${(entry.medianTimeMs / 1000).toFixed(1)}s`,
    entry.medianModelRequests === null ? 'n/a' : String(entry.medianModelRequests),
    entry.medianTotalTokens === null ? 'n/a' : String(entry.medianTotalTokens),
    entry.unsafeAttempts === null ? 'n/a' : String(entry.unsafeAttempts),
  ].join(' | '))
  return [
    'configuration | platform | valid runs | verified | median time | median requests | median tokens | unsafe',
    '--- | --- | --- | --- | --- | --- | --- | ---',
    ...rows,
  ]
}
