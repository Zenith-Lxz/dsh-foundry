/**
 * The changes panel.
 *
 * Renders {@link ReviewView} as the view model states it, including the parts a
 * prettier panel would drop. Three of those matter:
 *
 * - **Attribution is shown, and `unknown` is shown as unknown.** A row must not
 *   read as the agent's work because the panel had nothing better to say.
 * - **The scope note renders on every view**, not behind a tooltip. A review
 *   surface that looks like every other Git UI invites a hunt for a stage
 *   button; saying up front that there is none is faster than letting someone
 *   look for it.
 * - **Paths the agent claimed but the tree does not show** get their own block.
 *   That mismatch is the strongest signal a trajectory is wrong, and burying it
 *   in a list of ordinary rows loses it.
 *
 * Every action this panel can dispatch comes from `actionsForRow`, whose return
 * type has no mutating member. There is no code path here that could stage,
 * commit, or discard, and adding one would be a visible change to that type.
 * @module @dsh-foundry/daily-workbench/client/panels/ReviewPanel
 */
import type { ReactElement } from 'react'
import { actionsForRow, type ReviewAction, type ReviewRow, type ReviewView } from '../review-view.ts'

/** What the changes panel needs. */
export interface ReviewPanelProps {
  readonly view: ReviewView
  /** Dispatch a read-only action. */
  readonly onAction: (action: ReviewAction) => void
}

/** How each state reads as a heading. */
const SECTION_TITLE: Record<ReviewRow['state'], string> = {
  conflicted: 'Conflicted',
  staged: 'Staged',
  unstaged: 'Changed',
  untracked: 'Untracked',
}

/** How each attribution reads to someone deciding whether to trust a row. */
const ATTRIBUTION_LABEL: Record<ReviewRow['attribution'], string> = {
  agent: 'agent',
  external: 'changed outside this session',
  both: 'agent, then changed outside',
  unknown: 'unattributed',
}

/**
 * Render the changes panel.
 * @param props - View model and the action dispatcher.
 * @returns The panel.
 */
export function ReviewPanel({ view, onAction }: ReviewPanelProps): ReactElement {
  if (view.unavailable !== null) {
    return (
      <div className="dshw-panel dshw-panel--empty">
        <p className="dshw-empty-title">No repository review</p>
        <p className="dshw-empty-body">{view.unavailable}</p>
      </div>
    )
  }

  const empty = view.sections.every((section) => section.rows.length === 0)

  return (
    <div className="dshw-panel">
      {view.repository !== null && (
        <p className="dshw-branch">
          {view.repository.detached ? 'detached at ' : ''}
          <strong>{view.repository.branch}</strong>
          <button
            type="button"
            className="dshw-row-action"
            aria-label="Refresh repository status"
            onClick={() => onAction({ kind: 'refresh' })}
          >
            refresh
          </button>
        </p>
      )}

      {view.evidenceWarning !== null && (
        <p className="dshw-warning" role="status">{view.evidenceWarning}</p>
      )}

      {view.claimedButAbsent.length > 0 && (
        <section className="dshw-section dshw-section--alert">
          <h3 className="dshw-section-title">Claimed but not present</h3>
          <p className="dshw-section-note">
            The session recorded edits to these paths, but the working tree does not show them.
          </p>
          <ul className="dshw-rows">
            {view.claimedButAbsent.map((path) => (
              <li key={path} className="dshw-row">
                <button type="button" className="dshw-row-path" onClick={() => onAction({ kind: 'open-file', path })}>
                  {path}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {empty
        ? <p className="dshw-empty-body">No changes in the working tree.</p>
        : view.sections
          .filter((section) => section.rows.length > 0)
          .map((section) => (
            <section key={section.state} className="dshw-section">
              <h3 className="dshw-section-title">
                {SECTION_TITLE[section.state]}
                <span className="dshw-count">{section.rows.length}</span>
              </h3>
              <ul className="dshw-rows">
                {section.rows.map((row) => <Row key={row.path} row={row} onAction={onAction} />)}
              </ul>
            </section>
          ))}

      <p className="dshw-scope-note">{view.scopeNote}</p>
    </div>
  )
}

/**
 * Render one changed path.
 * @param props - The row and the action dispatcher.
 * @returns The row.
 */
function Row({ row, onAction }: {
  row: ReviewRow
  onAction: (action: ReviewAction) => void
}): ReactElement {
  return (
    <li className="dshw-row">
      <span className="dshw-code" title={`porcelain ${row.code}`}>{row.code.trim() || '—'}</span>
      <button
        type="button"
        className="dshw-row-path"
        onClick={() => onAction({ kind: 'open-file', path: row.path })}
        title={row.path}
        aria-label={`Open ${row.path}`}
      >
        {row.path}
      </button>
      <span
        className={`dshw-attribution dshw-attribution--${row.attribution}`}
        title="Who changed this path, according to the recorded session log"
      >
        {ATTRIBUTION_LABEL[row.attribution]}
      </span>
      {actionsForRow(row)
        .filter((action) => action.kind === 'show-diff')
        .map((action) => (
          <button
            key={action.kind}
            type="button"
            className="dshw-row-action"
            // Row buttons all read "diff" visually. Without the path in the
            // accessible name, tabbing through hears "diff, diff, diff" with no
            // way to tell which file each one belongs to.
            aria-label={`Show diff for ${row.path}`}
            onClick={() => onAction(action)}
          >
            diff
          </button>
        ))}
      {row.warning !== null && <span className="dshw-row-warning">{row.warning}</span>}
    </li>
  )
}
