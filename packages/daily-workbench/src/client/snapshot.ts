/**
 * Deriving workbench data from the official conversation snapshot.
 *
 * Three panels need no Host round trip: what commands ran, what the session is
 * currently doing, and what is wrong. All three are already in the snapshot the
 * official client maintains, so they work in a plain browser with no capability
 * mounted.
 *
 * Two facts the snapshot does *not* carry shape this module more than the ones
 * it does:
 *
 * - **No exit codes.** A `tool/result` records `isError`, not a process status,
 *   so a check that reported an error is `fail` and a check with no paired
 *   result is `unknown` — never `fail`. Reporting an unfinished command as a
 *   failure blames the change for an interruption.
 * - **No token capacity.** Occupancy is therefore reported as unavailable
 *   rather than drawn from a guessed denominator.
 * @module @dsh-foundry/daily-workbench/client/snapshot
 */
import type { VerificationEvidence } from '@dsh-foundry/daily-contract'
import { isVerificationCommand } from '../projection.ts'
import type { AttentionItem, ContextRecord } from './status-views.ts'

/** A settled tool result, as the official snapshot reports it. */
export interface ToolResultNode {
  readonly kind: 'tool-result'
  readonly seq: number
  readonly callId: string
  /** Call head, or `null` when window truncation left the call outside. */
  readonly call: { readonly name: string, readonly argsRaw: string } | null
  readonly isError: boolean
}

/** A compaction marker in the conversation. */
export interface CompactionNode {
  readonly kind: 'compaction-summary'
  readonly time: number
}

/** The snapshot fields this module reads. */
export interface SnapshotFacts {
  readonly nodes: readonly { readonly kind: string }[]
  readonly runningCalls: readonly { readonly callId: string, readonly name: string, readonly time: number }[]
  readonly removed: boolean
  readonly lastAgentError: string | null
  readonly subagent: { readonly parentAvailable: boolean } | null
}

/**
 * Extract the command a shell tool call ran.
 *
 * Returns `null` for anything whose arguments are not a JSON object with a
 * string `command`, because a tool whose arguments this cannot read is a tool
 * whose verification meaning is unknown, not one that passed.
 * @param argsRaw - Raw JSON arguments from the tool call.
 * @returns The command, or `null`.
 */
export function commandOf(argsRaw: string): string | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(argsRaw)
  } catch {
    // Unparseable arguments: not a command this can attribute meaning to.
    return null
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null
  const command = (parsed as { command?: unknown }).command
  return typeof command === 'string' && command.trim().length > 0 ? command : null
}

/**
 * Derive verification evidence from settled tool results.
 *
 * The official record carries `isError`, not a process status, so no real exit
 * code exists to report. What a settled `tool/result` *does* establish is that
 * the command completed, which is exactly what `exitCode: undefined` is
 * reserved to deny — so a settled result carries a completion marker (`0` or
 * `1`) and `passed` carries the verdict. The marker is never shown; only the
 * pass/fail/unknown outcome derived from it is.
 * @param nodes - Conversation nodes from the official snapshot.
 * @returns Evidence rows in sequence order.
 */
export function evidenceFromNodes(nodes: readonly { readonly kind: string }[]): VerificationEvidence[] {
  const evidence: VerificationEvidence[] = []
  for (const node of nodes) {
    if (node.kind !== 'tool-result') continue
    const result = node as unknown as ToolResultNode
    const command = result.call === null ? null : commandOf(result.call.argsRaw)
    if (command === null || !isVerificationCommand(command)) continue
    evidence.push({
      command,
      // A completion marker, not a recorded status: leaving it undefined would
      // render a definitely-failed check as "unknown".
      exitCode: result.isError ? 1 : 0,
      sequence: result.seq,
      passed: !result.isError,
    })
  }
  return evidence.sort((left, right) => left.sequence - right.sequence)
}

/**
 * Derive context accounting from the snapshot.
 *
 * Usage and capacity stay `null` because the official client snapshot does not
 * report them; only compaction history is observable here. A panel that drew a
 * bar from a missing denominator would look authoritative and be invented.
 * @param nodes - Conversation nodes from the official snapshot.
 * @returns The context record.
 */
export function contextFromNodes(nodes: readonly { readonly kind: string }[]): ContextRecord {
  const compactions = nodes.filter((node) => node.kind === 'compaction-summary')
  const last = compactions.at(-1) as CompactionNode | undefined
  return {
    usedTokens: null,
    capacityTokens: null,
    compactions: compactions.length,
    lastCompactionAt: last === undefined ? null : new Date(last.time).toISOString(),
  }
}

/**
 * Collect attention items the snapshot alone can establish.
 *
 * Deliberately narrow: only conditions the session itself reports. Items that
 * need repository state come from the review projection, and mixing the two
 * sources here would make an item's absence unreadable when the Host is not
 * reachable.
 * @param facts - The snapshot fields.
 * @returns Attention items, most urgent first.
 */
export function attentionFromSnapshot(facts: SnapshotFacts): AttentionItem[] {
  const items: AttentionItem[] = []
  if (facts.removed) {
    items.push({
      id: 'session-removed',
      severity: 'blocking',
      message: 'This session was removed on the host. Its transcript is readable, but it cannot continue.',
    })
  }
  if (facts.subagent !== null && !facts.subagent.parentAvailable) {
    items.push({
      id: 'parent-unavailable',
      severity: 'blocking',
      message: 'This subagent’s parent session is unavailable, so it cannot ask you anything and will wait.',
    })
  }
  if (facts.lastAgentError !== null) {
    items.push({ id: 'agent-error', severity: 'warning', message: facts.lastAgentError })
  }
  return items
}
