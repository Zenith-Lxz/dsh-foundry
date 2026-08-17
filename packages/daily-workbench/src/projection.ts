/**
 * Change attribution and verification projection.
 *
 * This is where "a check you did not run is not evidence" stops being advice
 * and becomes something a surface can check. Everything here derives from two
 * sources that cannot be talked into agreeing: the **durable session record**
 * of what tools actually ran, and the **current repository state**.
 *
 * The agent's prose is never an input. A final message claiming tests pass
 * produces no evidence; a recorded tool call with an exit code does.
 *
 * The projection also refuses to launder attribution. A file the agent never
 * touched but that differs from HEAD is reported as externally changed, not as
 * the agent's work — a review surface that blurs the two teaches its user to
 * trust an attribution that was never established.
 * @module @dsh-foundry/daily-workbench/projection
 */
import type { VerificationEvidence } from '@dsh-foundry/daily-contract'
import type { GitStatusEntry } from './git.ts'

/**
 * The durable record fields this projection reads.
 *
 * Declared structurally and narrowly: the projection consumes official session
 * events, and naming exactly the fields it depends on keeps that surface
 * visible when the upstream record grows.
 */
export interface DurableEvent {
  readonly type: string
  readonly seq: number
  readonly data?: {
    /** `tool/call`: the tool name. */
    readonly name?: string
    /** `tool/call`: JSON-encoded arguments. */
    readonly arguments?: string
    /** `tool/call`: correlation id. */
    readonly callId?: string
    /**
     * `tool/result`: the recorded result message.
     *
     * The correlation id and the outcome flag live inside this message rather
     * than beside it, which a flattened reading silently misses — the result
     * then never matches its call and every check reads as unverified.
     */
    readonly message?: {
      readonly source?: { readonly callId?: string }
      readonly content?: readonly { readonly isError?: boolean }[]
    }
  }
}

/** Where a currently-changed path came from. */
export type ChangeAttribution = 'agent' | 'external' | 'both'

/** One changed path with its attribution. */
export interface AttributedChange {
  readonly path: string
  readonly state: GitStatusEntry['state']
  /**
   * Who changed it.
   *
   * `both` means the agent edited the path **and** it changed again outside a
   * recorded tool call — the case where a stale review is most misleading.
   */
  readonly attribution: ChangeAttribution
}

/** The complete change-and-verification picture for a turn. */
export interface ChangeProjection {
  readonly changes: readonly AttributedChange[]
  readonly verification: readonly VerificationEvidence[]
  /**
   * Paths the agent edited that show no current change.
   *
   * Either the edit was reverted, or it was written and then undone — both are
   * worth surfacing, because the trajectory claims work the tree does not show.
   */
  readonly claimedButAbsent: readonly string[]
  /** True when at least one recorded check failed. */
  readonly hasFailingCheck: boolean
  /**
   * True when files changed after the last recorded check.
   *
   * The strongest signal a review surface can give: the evidence is real but
   * no longer describes the current tree.
   */
  readonly evidenceIsStale: boolean
}

/** Tool names that write files, whose calls attribute a path to the agent. */
const EDITING_TOOLS = new Set(['write', 'edit', 'str_replace_editor', 'create'])

/** Tool names that execute commands, whose results carry verification evidence. */
const EXECUTING_TOOLS = new Set(['bash', 'pwsh', 'terminal'])

/**
 * Command shapes recognized as project verification.
 *
 * Deliberately narrow. A broad pattern would promote an incidental `ls` into
 * evidence, and inflated evidence is worse than none: it is what lets a
 * surface report a task as checked when nothing checked it.
 */
const VERIFICATION_PATTERNS: readonly RegExp[] = [
  /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|lint|typecheck|check|build)\b/,
  /\bnode\s+--test\b/,
  /\b(?:pytest|tox|mypy|ruff)\b/,
  /\b(?:cargo|go)\s+(?:test|build|vet)\b/,
  /\bmake\s+(?:test|check|lint)\b/,
  /\btsc\b/,
  /\bvitest\b|\bjest\b|\bmocha\b/,
]

/**
 * Report whether a command reads as a project verification command.
 * @param command - The recorded command line.
 * @returns True when it matches a known verification shape.
 */
export function isVerificationCommand(command: string): boolean {
  return VERIFICATION_PATTERNS.some((pattern) => pattern.test(command))
}

/**
 * Read the outcome of a recorded tool result.
 *
 * The runtime records an `isError` flag rather than a process exit code, so
 * that flag is the available signal and the evidence's `exitCode` stays
 * `undefined`. Reporting an invented `0` would assert an exit status nothing
 * observed.
 *
 * An absent flag stays `undefined`, which the caller treats as not-passing: an
 * unknown outcome cannot support a claim that a check passed.
 * @param event - The `tool/result` event, or `undefined` when the call never settled.
 * @returns True when it completed without error, false on error, `undefined` when unrecorded.
 */
function outcomeOf(event: DurableEvent | undefined): boolean | undefined {
  const parts = event?.data?.message?.content
  if (parts === undefined) return undefined
  for (const part of parts) {
    if (typeof part.isError === 'boolean') return !part.isError
  }
  return undefined
}

/**
 * Read the correlation id a result belongs to.
 * @param event - The `tool/result` event.
 * @returns The call id, or `undefined`.
 */
function resultCallId(event: DurableEvent): string | undefined {
  return event.data?.message?.source?.callId
}

/**
 * Parse a recorded tool call's arguments.
 * @param event - The durable event.
 * @returns The parsed arguments, or an empty object.
 */
function argumentsOf(event: DurableEvent): Record<string, unknown> {
  const raw = event.data?.arguments
  if (typeof raw !== 'string') return {}
  try {
    return JSON.parse(raw) as Record<string, unknown>
  } catch {
    // A malformed argument record contributes nothing; it must not throw and
    // lose the rest of the projection.
    return {}
  }
}

/**
 * Build the change-and-verification projection for a session.
 *
 * @param events - Durable session events, oldest first.
 * @param status - Current Git status entries.
 * @param workspaceRoot - Workspace-relative root used to normalize edited paths.
 * @returns The projection.
 */
export function projectChanges(
  events: readonly DurableEvent[],
  status: readonly GitStatusEntry[],
  workspaceRoot: string,
): ChangeProjection {
  const editedPaths = new Set<string>()
  const verification: VerificationEvidence[] = []
  const resultsByCallId = new Map<string, DurableEvent>()
  let lastCheckSeq = -1
  let lastEditSeq = -1

  for (const event of events) {
    if (event.type !== 'tool/result') continue
    const callId = resultCallId(event)
    if (callId !== undefined) resultsByCallId.set(callId, event)
  }

  for (const event of events) {
    if (event.type !== 'tool/call') continue
    const name = event.data?.name
    if (name === undefined) continue
    const args = argumentsOf(event)

    if (EDITING_TOOLS.has(name)) {
      const path = args['file_path'] ?? args['path']
      if (typeof path === 'string') {
        editedPaths.add(normalizePath(path, workspaceRoot))
        lastEditSeq = Math.max(lastEditSeq, event.seq)
      }
      continue
    }

    if (!EXECUTING_TOOLS.has(name)) continue
    const command = args['command']
    if (typeof command !== 'string' || !isVerificationCommand(command)) continue

    const callId = event.data?.callId
    const outcome = outcomeOf(callId === undefined ? undefined : resultsByCallId.get(callId))
    verification.push({
      command,
      // This runtime records no exit code; the outcome flag below is the
      // available signal and inventing a code here would be a fabrication.
      exitCode: undefined,
      sequence: event.seq,
      // Unknown is not success. A command whose outcome was never recorded
      // cannot support a claim that the check passed.
      passed: outcome === true,
    })
    lastCheckSeq = Math.max(lastCheckSeq, event.seq)
  }

  const changedPaths = new Set(status.map((entry) => entry.path))
  const changes: AttributedChange[] = status.map((entry) => ({
    path: entry.path,
    state: entry.state,
    attribution: editedPaths.has(entry.path) ? 'agent' : 'external',
  }))

  return {
    changes,
    verification,
    claimedButAbsent: [...editedPaths].filter((path) => !changedPaths.has(path)).sort(),
    hasFailingCheck: verification.some((evidence) => !evidence.passed),
    // Evidence recorded before the last edit describes a tree that has since
    // moved on.
    evidenceIsStale: lastCheckSeq >= 0 && lastEditSeq > lastCheckSeq,
  }
}

/**
 * Normalize an edited path against the workspace root.
 *
 * Tool records carry absolute paths; the review surface speaks in
 * workspace-relative ones, and comparing the two forms directly is how an
 * agent-authored change gets misattributed as external.
 * @param path - Recorded path, absolute or relative.
 * @param workspaceRoot - Absolute workspace root.
 * @returns The workspace-relative POSIX path.
 */
function normalizePath(path: string, workspaceRoot: string): string {
  const normalized = path.split('\\').join('/')
  const root = workspaceRoot.split('\\').join('/').replace(/\/$/, '')
  if (normalized.startsWith(`${root}/`)) return normalized.slice(root.length + 1)
  return normalized.replace(/^\.\//, '')
}
