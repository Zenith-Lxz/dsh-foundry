/**
 * Running the corpus against configurations.
 *
 * The runner owns three things the results depend on and nothing else:
 * isolation, ordering, and the valid/invalid distinction.
 *
 * - **Isolation**: each run gets its own workspace and its own Harness home, so
 *   no run can read another's session log or inherit its installed profile.
 * - **Ordering**: configurations are rotated per task rather than run in blocks,
 *   so a host that gets slower over an hour does not systematically penalize
 *   whichever configuration ran last.
 * - **Validity**: an infrastructure, rate-limit, authentication, host-noise, or
 *   runner failure produces an *invalid* run with `verifiedSuccess: null`.
 *   Recording it as `false` would count a dropped network connection as the
 *   agent failing the task, which is the single easiest way to publish a
 *   comparison that is quietly wrong.
 *
 * Driving an agent is deliberately not this module's job — {@link AgentDriver}
 * is supplied by the caller, so the same runner serves the same-model lane and
 * the native-product lane without either knowing about the other.
 * @module @dsh-foundry/daily-eval/runner
 */
import { randomUUID } from 'node:crypto'
import { assembleMetrics, readSessionFacts, type SessionEvent } from './session-metrics.ts'
import {
  NO_METRICS,
  type ConfigurationIdentity,
  type InvalidationCause,
  type RunRecord,
  type TaskManifest,
} from './schema.ts'
import { changedPaths, diffLineCount, outOfScopeWrites, provision, runOracle, type Workspace } from './workspace.ts'

/** What a driver produced for one task. */
export interface DriverOutcome {
  /** Durable session events, when the driver exposes a session log. */
  readonly events: readonly SessionEvent[]
  /** Permission prompts the run answered, when the surface reports them. */
  readonly permissionDecisions: number | null
  /** An invalidation the driver detected, such as a rate limit. */
  readonly invalidation: { readonly cause: InvalidationCause, readonly detail: string } | null
}

/** Drives one configuration through one task. */
export interface AgentDriver {
  readonly identity: ConfigurationIdentity
  /**
   * Run the task in a workspace.
   *
   * Throws only on a runner fault; an agent that fails the task returns
   * normally and lets the oracle decide.
   * @param task - The task to run.
   * @param workspacePath - The isolated workspace.
   * @param signal - Aborted when the task timeout elapses.
   * @returns What the run produced.
   */
  run(task: TaskManifest, workspacePath: string, signal: AbortSignal): Promise<DriverOutcome>
}

/** Options for a corpus run. */
export interface RunOptions {
  readonly tasks: readonly TaskManifest[]
  readonly drivers: readonly AgentDriver[]
  readonly corpusRoot: string
  readonly repetitions: number
  /** Called after each run so a long sweep reports progress. */
  readonly onRun?: (record: RunRecord) => void
}

/**
 * Order runs so configurations rotate rather than running in blocks.
 *
 * Rotation is by repetition index, which keeps every configuration's runs spread
 * across the whole sweep. A host that degrades over time then affects all
 * configurations alike instead of only the last one.
 * @param tasks - Tasks to run.
 * @param drivers - Configurations to run them under.
 * @param repetitions - Repetitions per pair.
 * @returns The run plan, in execution order.
 */
export function planRuns(
  tasks: readonly TaskManifest[],
  drivers: readonly AgentDriver[],
  repetitions: number,
): { task: TaskManifest, driver: AgentDriver, repetition: number, order: number }[] {
  const plan: { task: TaskManifest, driver: AgentDriver, repetition: number, order: number }[] = []
  let order = 0
  for (let repetition = 1; repetition <= repetitions; repetition += 1) {
    for (const task of tasks) {
      for (let index = 0; index < drivers.length; index += 1) {
        // Rotate the starting configuration each repetition so no configuration
        // is always first, and therefore never always warmest or coldest.
        const driver = drivers[(index + repetition) % drivers.length]!
        plan.push({ task, driver, repetition, order })
        order += 1
      }
    }
  }
  return plan
}

/**
 * Classify a thrown value as an invalidation cause.
 *
 * Conservative on purpose: anything not recognized as infrastructure is a
 * runner failure, which is still invalid. Guessing that an unknown error means
 * the agent failed would silently convert noise into evidence.
 * @param error - The thrown value.
 * @returns The cause and its detail.
 */
export function classifyFailure(error: unknown): { cause: InvalidationCause, detail: string } {
  const message = error instanceof Error ? error.message : String(error)
  const lower = message.toLowerCase()
  if (/\b(429|rate.?limit|too many requests|quota)\b/.test(lower)) {
    return { cause: 'rate-limit', detail: bound(message) }
  }
  if (/\b(401|403|unauthorized|forbidden|api.?key|credential|authentication)\b/.test(lower)) {
    return { cause: 'authentication', detail: bound(message) }
  }
  if (/\b(econnreset|econnrefused|etimedout|enotfound|socket hang up|network|5\d\d)\b/.test(lower)) {
    return { cause: 'infrastructure', detail: bound(message) }
  }
  if (/\b(enospc|emfile|enomem|eagain|resource temporarily unavailable)\b/.test(lower)) {
    return { cause: 'host-noise', detail: bound(message) }
  }
  return { cause: 'runner-failure', detail: bound(message) }
}

/**
 * Run one task under one configuration.
 * @param task - The task.
 * @param driver - The configuration to run it under.
 * @param corpusRoot - Corpus root.
 * @param repetition - Which repetition this is.
 * @param order - Position in the sweep.
 * @returns The run record.
 */
export async function runOnce(
  task: TaskManifest,
  driver: AgentDriver,
  corpusRoot: string,
  repetition: number,
  order: number,
): Promise<RunRecord> {
  const startedAt = new Date()
  const base = {
    schemaVersion: 1,
    runId: randomUUID(),
    taskId: task.id,
    corpusVersion: task.corpusVersion,
    identity: driver.identity,
    repetition,
    order,
    startedAt: startedAt.toISOString(),
  }

  let workspace: Workspace
  try {
    workspace = provision(task, corpusRoot)
  } catch (error) {
    return {
      ...base,
      endedAt: new Date().toISOString(),
      verifiedSuccess: null,
      invalidation: classifyFailure(error),
      metrics: NO_METRICS,
      oracleEvidence: '',
    }
  }

  const controller = new AbortController()
  const deadline = setTimeout(() => controller.abort(), task.timeoutMs)
  try {
    let outcome: DriverOutcome
    try {
      outcome = await driver.run(task, workspace.path, controller.signal)
    } catch (error) {
      return {
        ...base,
        endedAt: new Date().toISOString(),
        verifiedSuccess: null,
        invalidation: classifyFailure(error),
        metrics: NO_METRICS,
        oracleEvidence: '',
      }
    }

    if (outcome.invalidation !== null) {
      return {
        ...base,
        endedAt: new Date().toISOString(),
        verifiedSuccess: null,
        invalidation: outcome.invalidation,
        metrics: NO_METRICS,
        oracleEvidence: '',
      }
    }

    // Measure the workspace before the oracle runs: an oracle may write files
    // of its own, and those are not agent changes.
    const changed = changedPaths(workspace)
    const outOfScope = outOfScopeWrites(task, changed)
    const diffLines = diffLineCount(workspace)
    const oracle = runOracle(task, workspace.path, corpusRoot)
    const endedAt = new Date()

    return {
      ...base,
      endedAt: endedAt.toISOString(),
      verifiedSuccess: oracle.passed,
      invalidation: null,
      metrics: assembleMetrics(readSessionFacts(outcome.events), {
        timeToVerifiedResultMs: oracle.passed ? endedAt.getTime() - startedAt.getTime() : null,
        permissionDecisions: outcome.permissionDecisions,
        unsafeAttempts: outOfScope.length,
        changedPaths: changed,
        diffLines,
        finalVerificationState: oracle.passed ? 'pass' : 'fail',
        resumeOutcome: null,
      }),
      oracleEvidence: oracle.evidence,
    }
  } finally {
    clearTimeout(deadline)
    workspace.dispose()
  }
}

/**
 * Run the whole plan.
 * @param options - Tasks, drivers, and repetitions.
 * @returns Every run record, valid and invalid.
 */
export async function runCorpus(options: RunOptions): Promise<RunRecord[]> {
  const records: RunRecord[] = []
  for (const step of planRuns(options.tasks, options.drivers, options.repetitions)) {
    if (!step.task.platforms.includes(step.driver.identity.platform)) continue
    const record = await runOnce(step.task, step.driver, options.corpusRoot, step.repetition, step.order)
    records.push(record)
    options.onRun?.(record)
  }
  return records
}

/**
 * Bound an error message so a record stays readable.
 * @param message - The message.
 * @returns A bounded message.
 */
function bound(message: string): string {
  return message.length > 300 ? `${message.slice(0, 300)}…` : message
}
