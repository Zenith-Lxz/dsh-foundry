/**
 * The read-only review surface.
 *
 * Presents working-tree state with two orthogonal facts kept separate and both
 * visible: **where a change lives** (staged, unstaged, untracked, conflicted)
 * and **who made it** (the agent, something outside this session, or both).
 * Collapsing either dimension is how a review surface misleads — a conflicted
 * path shown as merely unstaged hides an unfinished merge, and an
 * agent-attributed path shown without its external re-edit hides that the
 * trajectory no longer describes the file.
 *
 * Every action this view offers is read-only. There is no stage, commit,
 * discard, reset, clean, push, or rebase, and the absence is structural: the
 * action vocabulary is a closed union with no mutating member, so adding one
 * would be a visible type change rather than a new button.
 * @module @dsh-foundry/daily-workbench/client/review-view
 */
import type { GitInspection, GitStatusEntry } from '../git.ts'
import type { AttributedChange, ChangeProjection } from '../projection.ts'

/** Everything this view can ask for. Read-only by construction. */
export type ReviewAction =
  | { readonly kind: 'show-diff', readonly path: string }
  | { readonly kind: 'open-file', readonly path: string }
  | { readonly kind: 'refresh' }

/** One row in the review list. */
export interface ReviewRow {
  readonly path: string
  readonly state: GitStatusEntry['state']
  /** Who changed it, or `unknown` when no trajectory covered this path. */
  readonly attribution: AttributedChange['attribution'] | 'unknown'
  /** Two-character porcelain code, retained for a reader who wants specifics. */
  readonly code: string
  /** Why this row deserves attention, when it does. */
  readonly warning: string | null
}

/** A group of rows sharing a state. */
export interface ReviewSection {
  readonly state: GitStatusEntry['state']
  readonly rows: readonly ReviewRow[]
}

/** What the review surface shows. */
export interface ReviewView {
  /** Present only when the workspace is a usable repository. */
  readonly repository: { readonly branch: string, readonly detached: boolean } | null
  /** Why review is unavailable, phrased for a reader. */
  readonly unavailable: string | null
  readonly sections: readonly ReviewSection[]
  /** Paths the agent claims to have edited that the tree does not show. */
  readonly claimedButAbsent: readonly string[]
  /** Set when recorded checks no longer describe the current tree. */
  readonly evidenceWarning: string | null
  readonly actions: readonly ReviewAction[]
  /** Stated on every render, because a review surface that only shows findings reads as a clean bill. */
  readonly scopeNote: string
}

/** Order sections so the states needing a decision come first. */
const SECTION_ORDER: readonly GitStatusEntry['state'][] = ['conflicted', 'unstaged', 'staged', 'untracked']

/** What this surface does and does not do. */
export const REVIEW_SCOPE_NOTE =
  'Read-only review: this surface reads status and diffs and never stages, commits, discards, or rewrites history. '
  + 'It reports the working tree as Git sees it now, not whether the change is correct.'

/**
 * Explain why review is unavailable.
 * @param reason - Why the inspection failed.
 * @returns A sentence naming the cause and what remains possible.
 */
export function describeUnavailable(reason: 'not-a-repository' | 'git-missing' | 'failed'): string {
  return reason === 'not-a-repository'
    ? 'This workspace is not a Git repository, so there is no review to show. Everything else in the workbench still works.'
    : reason === 'git-missing'
      ? 'Git was not found on PATH, so status and diffs cannot be read. Install Git to enable review.'
      : 'Git could not read this repository. Its state is unknown — treat this as no information, not as a clean tree.'
}

/**
 * Build the review view.
 * @param inspection - Working-tree status from the Host.
 * @param projection - Attribution and verification for the current turn.
 * @returns The view model.
 */
export function buildReviewView(inspection: GitInspection, projection: ChangeProjection): ReviewView {
  if (!inspection.available) {
    return {
      repository: null,
      unavailable: describeUnavailable(inspection.reason),
      sections: [],
      claimedButAbsent: [],
      evidenceWarning: null,
      actions: [{ kind: 'refresh' }],
      scopeNote: REVIEW_SCOPE_NOTE,
    }
  }

  const attributionOf = new Map(projection.changes.map((change) => [change.path, change.attribution]))
  const sections: ReviewSection[] = []
  for (const state of SECTION_ORDER) {
    const rows = inspection.entries
      .filter((entry) => entry.state === state)
      .map((entry): ReviewRow => {
        const attribution = attributionOf.get(entry.path) ?? 'unknown'
        return {
          path: entry.path,
          state: entry.state,
          attribution,
          code: entry.code,
          warning: warningFor(entry.state, attribution),
        }
      })
      .sort((left, right) => left.path.localeCompare(right.path))
    if (rows.length > 0) sections.push({ state, rows })
  }

  return {
    repository: {
      branch: inspection.overview.branch ?? '(detached)',
      detached: inspection.overview.detached,
    },
    unavailable: null,
    sections,
    claimedButAbsent: projection.claimedButAbsent,
    evidenceWarning: projection.evidenceIsStale
      ? 'Files changed after the last recorded check, so the verification evidence below no longer describes this tree.'
      : null,
    actions: [{ kind: 'refresh' }],
    scopeNote: REVIEW_SCOPE_NOTE,
  }
}

/**
 * Name what makes a row worth a second look.
 * @param state - Where the change lives.
 * @param attribution - Who made it.
 * @returns The warning, or `null` for an ordinary row.
 */
function warningFor(
  state: GitStatusEntry['state'],
  attribution: ReviewRow['attribution'],
): string | null {
  if (state === 'conflicted') {
    return 'Unresolved merge conflict. This file is not in a reviewable state until the conflict is resolved.'
  }
  if (attribution === 'both') {
    return 'The agent edited this file and it also changed outside this session. The trajectory does not describe its current contents.'
  }
  if (attribution === 'external') {
    return 'Changed outside this session. No tool call in this trajectory accounts for it.'
  }
  return null
}

/**
 * Build the actions available for one row.
 *
 * Returned per row rather than fixed on the view so an unreviewable row offers
 * no diff — a conflicted file's diff is markers, not a change.
 * @param row - The row.
 * @returns Available actions.
 */
export function actionsForRow(row: ReviewRow): ReviewAction[] {
  if (row.state === 'conflicted') return [{ kind: 'open-file', path: row.path }]
  if (row.state === 'untracked') return [{ kind: 'open-file', path: row.path }]
  return [{ kind: 'show-diff', path: row.path }, { kind: 'open-file', path: row.path }]
}
