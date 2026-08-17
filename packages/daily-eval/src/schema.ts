/**
 * Versioned records for coding evaluation.
 *
 * The point of versioning every record is that a comparison claim is only
 * meaningful against a frozen set of inputs. When a task's setup or oracle
 * changes, its corpus version changes, and every claim derived from the old
 * version stops applying — see {@link claimIsExpired}, which enforces that
 * mechanically rather than trusting a reader to notice.
 *
 * Two lanes exist and never mix:
 *
 * - **same-model**: official Minimal / Standard / PTC / daily / adaptive under
 *   an identical model route, prompt, permissions, revision, platform, timeout,
 *   and oracle. Differences here are attributable to composition.
 * - **native-product**: whole products at their own defaults. Differences here
 *   are *not* attributable to composition, and the report says so.
 * @module @dsh-foundry/daily-eval/schema
 */

/** Schema version for every record in this module. Bump on any field change. */
export const EVAL_SCHEMA_VERSION = 1

/** Task categories the corpus must cover. */
export const TASK_CATEGORIES = [
  'repository-navigation',
  'bug-repair',
  'multi-file-feature',
  'refactoring',
  'failing-test-diagnosis',
  'long-session-resume',
  'git-diff-review',
  'platform-shell-behavior',
  // Added after a three-way sweep showed daily at or below the official
  // baseline on the other eight: none of them can observe whether unrelated
  // work survived, whether authority was respected, or whether the final
  // report was true, which is most of what the daily instructions ask for.
  'workspace-discipline',
] as const

/** One task category. */
export type TaskCategory = (typeof TASK_CATEGORIES)[number]

/** Minimum tasks per category the corpus must carry. */
export const MINIMUM_TASKS_PER_CATEGORY = 5

/** Minimum total tasks the corpus must carry. */
export const MINIMUM_CORPUS_SIZE = 45

/** Minimum repetitions for a stochastic configuration. */
export const MINIMUM_REPETITIONS = 3

/** The two lanes, which are reported separately and never pooled. */
export const EVAL_LANES = ['same-model', 'native-product'] as const

/** One evaluation lane. */
export type EvalLane = (typeof EVAL_LANES)[number]

/** A task in the corpus. */
export interface TaskManifest {
  readonly id: string
  readonly corpusVersion: number
  readonly category: TaskCategory
  /** What the agent is asked to do, verbatim. */
  readonly prompt: string
  /** Fixture directory, relative to the corpus root. */
  readonly fixture: string
  /** Platforms the task is meaningful on. */
  readonly platforms: readonly NodeJS.Platform[]
  /** Wall-clock ceiling for one run, in milliseconds. */
  readonly timeoutMs: number
  /** Paths the agent may change, relative to the workspace root. */
  readonly allowedScope: readonly string[]
  /** Decisions that stay with the user and must not be made for them. */
  readonly userAuthority: readonly string[]
  /** Whether the oracle needs network access or credentials. */
  readonly requiresNetwork: boolean
  /** How success is checked, as a command run in the workspace. */
  readonly oracle: { readonly command: string, readonly args: readonly string[] }
  /** Why this task exists and what a passing result does and does not show. */
  readonly rationale: string
}

/** The identity a run was produced under. Any drift expires derived claims. */
export interface ConfigurationIdentity {
  readonly lane: EvalLane
  /** Configuration name: a preset id, `daily`, `adaptive`, or a product name. */
  readonly configuration: string
  /** Product or distribution version. */
  readonly productVersion: string
  /** Model route as the runner requested it. */
  readonly model: string
  /** Reasoning effort as the runner requested it, when the route exposes one. */
  readonly reasoningEffort: string | null
  readonly platform: NodeJS.Platform
  readonly architecture: string
  /** Pinned DSH version, for the same-model lane. */
  readonly dshVersion: string | null
}

/** Why a run does not count as evidence about the agent. */
export const INVALIDATION_CAUSES = [
  'infrastructure',
  'rate-limit',
  'authentication',
  'host-noise',
  'runner-failure',
] as const

/** One invalidation cause. */
export type InvalidationCause = (typeof INVALIDATION_CAUSES)[number]

/** What one run produced. */
export interface RunRecord {
  readonly schemaVersion: number
  readonly runId: string
  readonly taskId: string
  readonly corpusVersion: number
  readonly identity: ConfigurationIdentity
  readonly repetition: number
  /** Order this configuration ran in, to expose ordering effects. */
  readonly order: number
  readonly startedAt: string
  readonly endedAt: string
  /**
   * Whether the oracle passed.
   *
   * `null` when the run was invalidated: an invalid run has no agent verdict,
   * and recording `false` would silently count infrastructure as failure.
   */
  readonly verifiedSuccess: boolean | null
  readonly invalidation: { readonly cause: InvalidationCause, readonly detail: string } | null
  readonly metrics: RunMetrics
  /** Oracle stdout/stderr, redacted, retained so a verdict can be re-read. */
  readonly oracleEvidence: string
}

/** What was measured during a run. Absent measurements are `null`, never `0`. */
export interface RunMetrics {
  readonly timeToVerifiedResultMs: number | null
  readonly modelRequests: number | null
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cachedTokens: number | null
  readonly toolCalls: number | null
  readonly userInterventions: number | null
  readonly permissionDecisions: number | null
  /** Attempts outside the task's allowed scope or user authority. */
  readonly unsafeAttempts: number | null
  /** Whether a resumed session continued correctly; `null` when not applicable. */
  readonly resumeOutcome: 'continued' | 'restarted' | 'lost' | null
  readonly changedPaths: readonly string[]
  readonly diffLines: number | null
  readonly finalVerificationState: 'pass' | 'fail' | 'unknown'
}

/** A metrics record with every measurement absent. */
export const NO_METRICS: RunMetrics = {
  timeToVerifiedResultMs: null,
  modelRequests: null,
  inputTokens: null,
  outputTokens: null,
  cachedTokens: null,
  toolCalls: null,
  userInterventions: null,
  permissionDecisions: null,
  unsafeAttempts: null,
  resumeOutcome: null,
  changedPaths: [],
  diffLines: null,
  finalVerificationState: 'unknown',
}

/** A comparison claim, bound to the identities that justify it. */
export interface ComparisonClaim {
  readonly statement: string
  readonly corpusVersion: number
  readonly identities: readonly ConfigurationIdentity[]
  readonly issuedAt: string
}

/**
 * Decide whether a claim still applies to the current identities.
 *
 * A claim expires when the corpus version moved or when any identity it was
 * derived from is no longer present unchanged. This is the mechanism that stops
 * a README from carrying a number that a version bump quietly invalidated.
 * @param claim - The claim to test.
 * @param current - Identities present in the run being reported now.
 * @param corpusVersion - The corpus version in effect now.
 * @returns The expiry reason, or `null` when the claim still holds.
 */
export function claimIsExpired(
  claim: ComparisonClaim,
  current: readonly ConfigurationIdentity[],
  corpusVersion: number,
): string | null {
  if (claim.corpusVersion !== corpusVersion) {
    return `corpus version moved from ${claim.corpusVersion} to ${corpusVersion}`
  }
  for (const identity of claim.identities) {
    const match = current.find(
      (candidate) => candidate.lane === identity.lane && candidate.configuration === identity.configuration,
    )
    if (match === undefined) return `configuration ${identity.configuration} is no longer evaluated`
    const drift = identityDrift(identity, match)
    if (drift !== null) return `${identity.configuration}: ${drift}`
  }
  return null
}

/**
 * Name the first field in which two identities differ.
 * @param expected - The identity a claim was derived from.
 * @param actual - The identity present now.
 * @returns A description of the drift, or `null` when they match.
 */
export function identityDrift(
  expected: ConfigurationIdentity,
  actual: ConfigurationIdentity,
): string | null {
  const fields: readonly (keyof ConfigurationIdentity)[] = [
    'productVersion', 'model', 'reasoningEffort', 'platform', 'architecture', 'dshVersion',
  ]
  for (const field of fields) {
    if (expected[field] !== actual[field]) {
      return `${field} changed from ${String(expected[field])} to ${String(actual[field])}`
    }
  }
  return null
}

/**
 * Check that a corpus satisfies the coverage floors.
 *
 * Returns problems rather than throwing so a report can state exactly which
 * floors a partial corpus misses instead of claiming coverage it lacks.
 * @param tasks - The corpus.
 * @returns Coverage problems, empty when the corpus qualifies.
 */
export function checkCoverage(tasks: readonly TaskManifest[]): string[] {
  const problems: string[] = []
  if (tasks.length < MINIMUM_CORPUS_SIZE) {
    problems.push(`corpus has ${tasks.length} tasks, below the required ${MINIMUM_CORPUS_SIZE}`)
  }
  for (const category of TASK_CATEGORIES) {
    const count = tasks.filter((task) => task.category === category).length
    if (count < MINIMUM_TASKS_PER_CATEGORY) {
      problems.push(`category ${category} has ${count} tasks, below the required ${MINIMUM_TASKS_PER_CATEGORY}`)
    }
  }
  const seen = new Set<string>()
  for (const task of tasks) {
    if (seen.has(task.id)) problems.push(`duplicate task id ${task.id}`)
    seen.add(task.id)
  }
  return problems
}
