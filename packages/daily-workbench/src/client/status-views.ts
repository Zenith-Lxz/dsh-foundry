/**
 * Verification, context, jobs, subagents, and attention.
 *
 * Every view here is derived from typed records the harness or the companion
 * already produces. Nothing is inferred from rendered text, and nothing is
 * estimated: a value the records do not carry is absent, and the view says so
 * rather than showing a plausible number.
 *
 * Control actions are declared per item and only when the underlying record
 * supports them. A surface that offers "cancel" for a job it cannot cancel
 * teaches the user that the button is a lie, which is worse than not offering
 * it — so the supported set is computed from the record, not assumed.
 * @module @dsh-foundry/daily-workbench/client/status-views
 */
import type { VerificationEvidence } from '@dsh-foundry/daily-contract'

/** How a check turned out, as the records support. */
export type CheckOutcome = 'pass' | 'fail' | 'unknown'

/** One verification row. */
export interface VerificationRow {
  readonly command: string
  readonly outcome: CheckOutcome
  /** Durable session event sequence this row came from. */
  readonly sequence: number
  /** Why this row is not conclusive, when it is not. */
  readonly caveat: string | null
}

/** The verification panel. */
export interface VerificationView {
  readonly rows: readonly VerificationRow[]
  /** Set when the tree changed after the newest check. */
  readonly staleWarning: string | null
  /** Stated always: passing checks are not a correctness claim. */
  readonly scopeNote: string
  readonly empty: boolean
}

/** What a passing check does and does not establish. */
export const VERIFICATION_SCOPE_NOTE =
  'These are the checks this session actually ran, as recorded. A pass means the command exited successfully; '
  + 'it is not a statement that the change is correct, and a command this list does not name was not run.'

/**
 * Build the verification panel.
 * @param evidence - Recorded checks, oldest first.
 * @param evidenceIsStale - Whether files changed after the last check.
 * @returns The view model.
 */
export function buildVerificationView(
  evidence: readonly VerificationEvidence[],
  evidenceIsStale: boolean,
): VerificationView {
  const rows = evidence.map((entry): VerificationRow => {
    const outcome = outcomeOf(entry)
    return {
      command: entry.command,
      outcome,
      sequence: entry.sequence,
      caveat: outcome === 'unknown'
        ? 'The session log records this command but not a completed result, so it is not evidence either way.'
        : null,
    }
  })
  return {
    rows,
    staleWarning: evidenceIsStale && rows.length > 0
      ? 'Files changed after the newest check. Re-run verification before trusting these results.'
      : null,
    scopeNote: VERIFICATION_SCOPE_NOTE,
    empty: rows.length === 0,
  }
}

/**
 * Derive an outcome from one recorded check.
 *
 * A command with no exit code did not complete, which is neither a pass nor a
 * failure; reporting it as failure would attribute an interrupted run to the
 * change under review.
 * @param entry - The recorded evidence.
 * @returns The outcome.
 */
function outcomeOf(entry: VerificationEvidence): CheckOutcome {
  if (entry.passed) return 'pass'
  return entry.exitCode === undefined ? 'unknown' : 'fail'
}

/** Token accounting as the official records report it. */
export interface ContextRecord {
  readonly usedTokens: number | null
  readonly capacityTokens: number | null
  readonly compactions: number
  /** When the most recent compaction happened, when one has. */
  readonly lastCompactionAt: string | null
}

/** The context panel. */
export interface ContextView {
  /** Occupancy as a fraction, or `null` when either side is unreported. */
  readonly occupancy: number | null
  readonly usedTokens: number | null
  readonly capacityTokens: number | null
  readonly compactions: number
  readonly lastCompactionAt: string | null
  /** What the reader should know about how this number behaves. */
  readonly caveat: string
  readonly actions: readonly { readonly kind: 'compact-now' }[]
}

/**
 * Build the context panel.
 *
 * Occupancy is `null` unless both sides were reported. Rendering a bar from a
 * missing capacity would show an authoritative-looking gauge for a number
 * nobody measured.
 * @param record - Official context accounting.
 * @param canCompact - Whether the surface supports requesting a compaction.
 * @returns The view model.
 */
export function buildContextView(record: ContextRecord, canCompact: boolean): ContextView {
  const occupancy = record.usedTokens === null || record.capacityTokens === null || record.capacityTokens === 0
    ? null
    : record.usedTokens / record.capacityTokens
  return {
    occupancy,
    usedTokens: record.usedTokens,
    capacityTokens: record.capacityTokens,
    compactions: record.compactions,
    lastCompactionAt: record.lastCompactionAt,
    caveat: occupancy === null
      ? 'Context occupancy was not reported for this session, so no figure is shown. This is unknown, not empty.'
      : 'Occupancy is a reference figure assembled from separate observations, not one atomic measurement, and it is not a billing input.',
    actions: canCompact ? [{ kind: 'compact-now' }] : [],
  }
}

/** A background job as the official records describe it. */
export interface JobRecord {
  readonly id: string
  readonly label: string
  readonly state: 'running' | 'succeeded' | 'failed' | 'cancelled'
  readonly startedAt: string
  /** Whether the surface that owns this job supports cancelling it. */
  readonly cancellable: boolean
}

/** One job row with only the actions its record supports. */
export interface JobRow {
  readonly id: string
  readonly label: string
  readonly state: JobRecord['state']
  readonly startedAt: string
  readonly actions: readonly ({ readonly kind: 'cancel', readonly id: string } | { readonly kind: 'show-output', readonly id: string })[]
}

/**
 * Build the jobs panel.
 *
 * Cancel is offered only for a running job whose record says it is cancellable.
 * Offering it otherwise produces a button that cannot work, which is a worse
 * outcome than an absent one.
 * @param jobs - Official job records.
 * @returns The rows, running first.
 */
export function buildJobRows(jobs: readonly JobRecord[]): JobRow[] {
  return [...jobs]
    .sort((left, right) => Number(right.state === 'running') - Number(left.state === 'running'))
    .map((job): JobRow => ({
      id: job.id,
      label: job.label,
      state: job.state,
      startedAt: job.startedAt,
      actions: [
        ...(job.state === 'running' && job.cancellable ? [{ kind: 'cancel' as const, id: job.id }] : []),
        { kind: 'show-output' as const, id: job.id },
      ],
    }))
}

/** A subagent as the official records describe it. */
export interface SubagentRecord {
  readonly id: string
  readonly label: string
  readonly state: 'running' | 'finished' | 'failed'
  /** Distribution mode the subagent runs under. */
  readonly mode: string
}

/** One subagent row. */
export interface SubagentRow {
  readonly id: string
  readonly label: string
  readonly state: SubagentRecord['state']
  readonly mode: string
  /** Set when the subagent's mode differs from the parent's. */
  readonly modeNote: string | null
  readonly actions: readonly { readonly kind: 'open-transcript', readonly id: string }[]
}

/**
 * Build the subagents panel.
 * @param subagents - Official subagent records.
 * @param parentMode - The parent session's distribution mode.
 * @returns The rows.
 */
export function buildSubagentRows(
  subagents: readonly SubagentRecord[],
  parentMode: string,
): SubagentRow[] {
  return subagents.map((subagent): SubagentRow => ({
    id: subagent.id,
    label: subagent.label,
    state: subagent.state,
    mode: subagent.mode,
    modeNote: subagent.mode === parentMode
      ? null
      : `Runs in ${subagent.mode} mode while this session runs in ${parentMode}.`,
    actions: [{ kind: 'open-transcript', id: subagent.id }],
  }))
}

/** Something the user should look at. */
export interface AttentionItem {
  readonly id: string
  /** Ordered most urgent first when rendered. */
  readonly severity: 'blocking' | 'warning' | 'info'
  readonly message: string
}

/**
 * Collect what needs attention across the workbench.
 *
 * Assembled from the other views rather than tracked separately, so an item can
 * never disagree with the panel it came from.
 * @param input - The views to read.
 * @returns Attention items, most urgent first.
 */
export function collectAttention(input: {
  readonly conflictedPaths: readonly string[]
  readonly failingChecks: readonly string[]
  readonly evidenceIsStale: boolean
  readonly claimedButAbsent: readonly string[]
  readonly failedJobs: readonly JobRow[]
  readonly failedSubagents: readonly SubagentRow[]
}): AttentionItem[] {
  const items: AttentionItem[] = []

  for (const path of input.conflictedPaths) {
    items.push({ id: `conflict:${path}`, severity: 'blocking', message: `${path} has an unresolved merge conflict.` })
  }
  for (const command of input.failingChecks) {
    items.push({ id: `check:${command}`, severity: 'blocking', message: `\`${command}\` failed.` })
  }
  for (const job of input.failedJobs) {
    items.push({ id: `job:${job.id}`, severity: 'warning', message: `Background job "${job.label}" failed.` })
  }
  for (const subagent of input.failedSubagents) {
    items.push({ id: `subagent:${subagent.id}`, severity: 'warning', message: `Subagent "${subagent.label}" failed.` })
  }
  if (input.evidenceIsStale) {
    items.push({
      id: 'evidence:stale',
      severity: 'warning',
      message: 'Files changed after the last check, so the current evidence does not describe this tree.',
    })
  }
  for (const path of input.claimedButAbsent) {
    items.push({
      id: `absent:${path}`,
      severity: 'info',
      message: `The agent edited ${path}, but the tree shows no change there.`,
    })
  }

  const rank = { blocking: 0, warning: 1, info: 2 } as const
  return items.sort((left, right) => rank[left.severity] - rank[right.severity])
}
