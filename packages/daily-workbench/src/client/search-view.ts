/**
 * Search results, grouped for reading.
 *
 * A pure view model: given hits and the request they answer, produce what the
 * panel shows. Rendering stays separate so the decisions that matter — what
 * counts as stale, what a truncated result must disclose — are testable without
 * a browser.
 *
 * Two properties this module exists to guarantee:
 *
 * - **A stale result is never shown as current.** Results arrive out of order
 *   when a user keeps typing; a result whose query no longer matches the box is
 *   discarded rather than rendered under the newer query.
 * - **Truncation is always disclosed.** A developer who cannot see that a search
 *   stopped early will read a missing match as an absent match, which is worse
 *   than seeing no results at all.
 * @module @dsh-foundry/daily-workbench/client/search-view
 */
import { DEFAULT_EXCLUDED_DIRECTORIES } from '../discovery.ts'
import type { BoundedResult, SearchHit, TruncationReason } from '../discovery.ts'

/** One file's matches. */
export interface SearchGroup {
  /** Workspace-relative path. */
  readonly path: string
  readonly matches: readonly { readonly line: number, readonly preview: string }[]
  /** Matches beyond those listed, when this file's list was capped. */
  readonly hiddenMatches: number
}

/** Why a result stopped early, phrased for a reader. */
export interface TruncationNotice {
  readonly reason: TruncationReason
  /** What the reader should conclude, and what they must not. */
  readonly message: string
}

/** What the results panel shows. */
export interface SearchView {
  readonly query: string
  readonly groups: readonly SearchGroup[]
  readonly totalMatches: number
  readonly truncation: TruncationNotice | null
  /** Directories excluded from the walk, disclosed so absence is readable. */
  readonly excludedDirectories: readonly string[]
  /** True when the search ran and matched nothing. */
  readonly empty: boolean
}

/** Matches listed per file before the rest are summarized. */
export const MATCHES_PER_FILE = 20

/**
 * Explain a truncation in terms of what the reader may conclude.
 *
 * Each message states the limit *and* the inference it forbids, because the
 * dangerous reading of a short result list is "there is nothing else".
 * @param reason - Why the search stopped.
 * @returns The notice.
 */
export function describeTruncation(reason: TruncationReason): TruncationNotice {
  const message = reason === 'entries'
    ? 'Stopped after reaching the file-count limit. Files beyond it were not searched, so this is not a complete list of matches.'
    : reason === 'results'
      ? 'Stopped after reaching the match limit. Narrow the query to see the rest; more matches exist.'
      : reason === 'time'
        ? 'Stopped at the time limit. Part of the workspace was not searched, so a missing file here does not mean it has no match.'
        : 'Cancelled because the query changed. These results are partial.'
  return { reason, message }
}

/**
 * Decide whether a result still answers what the user is asking.
 *
 * Searches resolve out of order, so an older, slower request can land after a
 * newer one. Comparing the query the result answers against the current box is
 * what stops an old answer from appearing under a new question.
 * @param resultQuery - The query this result answered.
 * @param currentQuery - The query in the box now.
 * @returns True when the result is stale and must not be shown.
 */
export function isStale(resultQuery: string, currentQuery: string): boolean {
  return resultQuery !== currentQuery
}

/**
 * Build the results view.
 * @param query - The query these hits answer.
 * @param result - Bounded hits from the Host.
 * @param excluded - Directories excluded from the walk.
 * @returns The view model.
 */
export function buildSearchView(
  query: string,
  result: BoundedResult<SearchHit>,
  excluded: readonly string[] = DEFAULT_EXCLUDED_DIRECTORIES,
): SearchView {
  const byPath = new Map<string, { line: number, preview: string }[]>()
  for (const hit of result.items) {
    const bucket = byPath.get(hit.path) ?? []
    bucket.push({ line: hit.line, preview: hit.preview })
    byPath.set(hit.path, bucket)
  }

  const groups: SearchGroup[] = []
  for (const [path, matches] of [...byPath.entries()].sort(([left], [right]) => left.localeCompare(right))) {
    const ordered = [...matches].sort((left, right) => left.line - right.line)
    groups.push({
      path,
      matches: ordered.slice(0, MATCHES_PER_FILE),
      hiddenMatches: Math.max(0, ordered.length - MATCHES_PER_FILE),
    })
  }

  return {
    query,
    groups,
    totalMatches: result.items.length,
    truncation: result.truncatedBy === undefined ? null : describeTruncation(result.truncatedBy),
    excludedDirectories: excluded,
    empty: result.items.length === 0,
  }
}

/**
 * The official operation that opens a search hit.
 *
 * Named as a request rather than performed here: opening a file is the host
 * application's job, and the workbench must not reach for an editor itself.
 * @param path - Workspace-relative path.
 * @param line - One-based line to reveal.
 * @returns The open request.
 */
export function openRequest(path: string, line: number): { readonly path: string, readonly line: number } {
  return { path, line }
}
