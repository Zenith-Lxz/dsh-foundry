/**
 * Deriving run metrics from the official durable session log.
 *
 * Every number here comes from a record the harness already writes. Nothing is
 * inferred from private state, and no metric is estimated: a measurement the
 * log does not carry stays `null` rather than becoming a plausible-looking zero.
 *
 * The event shapes are the official ones for the pinned DSH version:
 *
 * ```text
 * user/message        UserMessage            source.kind 'user' = a human prompt
 * assistant/message   { turn, step, message, usage? }   usage carries the accounting
 * tool/call           { turn, step, callId, name, arguments }
 * tool/result         { message: { source.callId, content[].isError } }
 * ```
 *
 * `usage` is absent whenever the adapter reported no accounting, which is why
 * token totals are optional all the way through the report.
 * @module @dsh-foundry/daily-eval/session-metrics
 */
import type { RunMetrics } from './schema.ts'

/** One durable session event, read structurally. */
export interface SessionEvent {
  readonly type: string
  readonly data?: unknown
}

/** Token accounting as the LLM capability reports it. */
interface TokenUsage {
  readonly inputTokens?: number
  readonly outputTokens?: number
  readonly cacheReadTokens?: number
  readonly cacheWriteTokens?: number
}

/** What a session log says happened, before oracle and workspace facts are added. */
export interface SessionFacts {
  readonly modelRequests: number
  readonly toolCalls: number
  readonly failedToolCalls: number
  /** Direct human prompts after the first, which starts the task. */
  readonly userInterventions: number
  readonly inputTokens: number | null
  readonly outputTokens: number | null
  readonly cachedTokens: number | null
  /** Tool names the model actually invoked, in first-use order. */
  readonly toolsUsed: readonly string[]
}

/**
 * Read what a session log records about one run.
 * @param events - Durable session events, in log order.
 * @returns The facts the log supports.
 */
export function readSessionFacts(events: readonly SessionEvent[]): SessionFacts {
  let modelRequests = 0
  let toolCalls = 0
  let failedToolCalls = 0
  let humanPrompts = 0
  let inputTokens: number | null = null
  let outputTokens: number | null = null
  let cachedTokens: number | null = null
  const toolsUsed: string[] = []

  for (const event of events) {
    switch (event.type) {
      case 'assistant/message': {
        modelRequests += 1
        const usage = (event.data as { usage?: TokenUsage } | undefined)?.usage
        if (usage !== undefined) {
          // Accumulate only what this step actually reported: adding a zero for
          // a step with no accounting would understate the per-request average.
          if (usage.inputTokens !== undefined) inputTokens = (inputTokens ?? 0) + usage.inputTokens
          if (usage.outputTokens !== undefined) outputTokens = (outputTokens ?? 0) + usage.outputTokens
          const cached = (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
          if (usage.cacheReadTokens !== undefined || usage.cacheWriteTokens !== undefined) {
            cachedTokens = (cachedTokens ?? 0) + cached
          }
        }
        break
      }
      case 'tool/call': {
        toolCalls += 1
        const name = (event.data as { name?: string } | undefined)?.name
        if (name !== undefined && !toolsUsed.includes(name)) toolsUsed.push(name)
        break
      }
      case 'tool/result': {
        const content = (event.data as { message?: { content?: { isError?: boolean }[] } } | undefined)?.message?.content
        if (content?.some((block) => block.isError === true) === true) failedToolCalls += 1
        break
      }
      case 'user/message': {
        // `plugin`-sourced messages are synthetic context the harness injected,
        // not a person stepping in; counting them would make every run look
        // heavily supervised.
        if ((event.data as { source?: { kind?: string } } | undefined)?.source?.kind === 'user') humanPrompts += 1
        break
      }
      default:
        // Merge-extensible vocabulary: an unrecognized event contributes nothing
        // rather than invalidating the log.
        break
    }
  }

  return {
    modelRequests,
    toolCalls,
    failedToolCalls,
    // The first human prompt is the task itself; only later ones are interventions.
    userInterventions: Math.max(0, humanPrompts - 1),
    inputTokens,
    outputTokens,
    cachedTokens,
    toolsUsed,
  }
}

/**
 * Whether a resumed session continued its prior work.
 *
 * Derived from the durable log alone: a resume that produced model output
 * without a fresh human prompt continued; one that took a new prompt first
 * restarted; a log with neither lost the thread.
 * @param events - Events recorded after the resume point.
 * @returns The resume outcome.
 */
export function readResumeOutcome(events: readonly SessionEvent[]): RunMetrics['resumeOutcome'] {
  const first = events.find(
    (event) => event.type === 'assistant/message'
      || event.type === 'tool/call'
      || (event.type === 'user/message'
        && (event.data as { source?: { kind?: string } } | undefined)?.source?.kind === 'user'),
  )
  if (first === undefined) return 'lost'
  return first.type === 'user/message' ? 'restarted' : 'continued'
}

/**
 * Assemble the full metrics record for a run.
 * @param facts - What the session log recorded.
 * @param observed - What the runner measured outside the log.
 * @returns The metrics record.
 */
export function assembleMetrics(
  facts: SessionFacts,
  observed: {
    readonly timeToVerifiedResultMs: number | null
    readonly permissionDecisions: number | null
    readonly unsafeAttempts: number
    readonly changedPaths: readonly string[]
    readonly diffLines: number | null
    readonly finalVerificationState: RunMetrics['finalVerificationState']
    readonly resumeOutcome: RunMetrics['resumeOutcome']
  },
): RunMetrics {
  return {
    timeToVerifiedResultMs: observed.timeToVerifiedResultMs,
    modelRequests: facts.modelRequests,
    inputTokens: facts.inputTokens,
    outputTokens: facts.outputTokens,
    cachedTokens: facts.cachedTokens,
    toolCalls: facts.toolCalls,
    userInterventions: facts.userInterventions,
    permissionDecisions: observed.permissionDecisions,
    unsafeAttempts: observed.unsafeAttempts,
    resumeOutcome: observed.resumeOutcome,
    changedPaths: observed.changedPaths,
    diffLines: observed.diffLines,
    finalVerificationState: observed.finalVerificationState,
  }
}
