/**
 * Verification, context, jobs, subagents, and attention.
 *
 * These five share a rule: **a value that was not measured is drawn as absent,
 * never as zero or full.** A context bar rendered from a missing capacity is an
 * authoritative-looking guess, and a check whose command was interrupted is
 * `unknown`, not `fail` — reporting an interruption as failure blames the change
 * for an accident.
 *
 * Buttons follow the same rule from the other direction: an action renders only
 * when the record says it is available. A cancel button that does nothing is
 * worse than no cancel button, because it costs the user a click and their
 * confidence in the panel.
 * @module @dsh-foundry/daily-workbench/client/panels/StatusPanels
 */
import type { ReactElement } from 'react'
import type {
  AttentionItem,
  CheckOutcome,
  ContextView,
  JobRow,
  SubagentRow,
  VerificationView,
} from '../status-views.ts'

/** How each outcome reads. */
const OUTCOME_LABEL: Record<CheckOutcome, string> = {
  pass: 'passed',
  fail: 'failed',
  unknown: 'unknown',
}

/**
 * Render the verification panel.
 * @param props - The verification view.
 * @returns The panel.
 */
export function VerificationPanel({ view }: { view: VerificationView }): ReactElement {
  return (
    <div className="dshw-panel">
      {view.staleWarning !== null && <p className="dshw-warning" role="status">{view.staleWarning}</p>}
      {view.empty
        ? <p className="dshw-empty-body">No verification commands were recorded in this session.</p>
        : (
          <ul className="dshw-rows">
            {view.rows.map((row) => (
              <li key={`${row.sequence}-${row.command}`} className="dshw-row">
                <span className={`dshw-outcome dshw-outcome--${row.outcome}`}>{OUTCOME_LABEL[row.outcome]}</span>
                <code className="dshw-command">{row.command}</code>
                {row.caveat !== null && <span className="dshw-row-warning">{row.caveat}</span>}
              </li>
            ))}
          </ul>
        )}
      <p className="dshw-scope-note">{view.scopeNote}</p>
    </div>
  )
}

/**
 * Render the context panel.
 * @param props - The context view and the compaction handler.
 * @returns The panel.
 */
export function ContextPanel({ view, onCompact }: {
  view: ContextView
  onCompact: () => void
}): ReactElement {
  return (
    <div className="dshw-panel">
      {view.occupancy === null
        ? (
          // Drawing a bar here would require inventing the missing half.
          <p className="dshw-empty-body">
            Context occupancy is unavailable: {view.usedTokens === null ? 'usage' : 'capacity'} was not reported.
          </p>
        )
        : (
          <div className="dshw-meter" role="img" aria-label={`context ${Math.round(view.occupancy * 100)}% full`}>
            <div className="dshw-meter-fill" style={{ width: `${Math.min(100, view.occupancy * 100)}%` }} />
            <span className="dshw-meter-label">
              {view.usedTokens?.toLocaleString()} / {view.capacityTokens?.toLocaleString()} tokens
            </span>
          </div>
        )}
      <p className="dshw-detail">
        {view.compactions} compaction{view.compactions === 1 ? '' : 's'}
        {view.lastCompactionAt !== null && `, most recent ${view.lastCompactionAt}`}
      </p>
      <p className="dshw-scope-note">{view.caveat}</p>
      {view.actions.some((action) => action.kind === 'compact-now') && (
        <button type="button" className="dshw-button" onClick={onCompact}>Compact now</button>
      )}
    </div>
  )
}

/**
 * Render the background jobs panel.
 * @param props - Job rows and action handlers.
 * @returns The panel.
 */
export function JobsPanel({ rows, onCancel, onShowOutput }: {
  rows: readonly JobRow[]
  onCancel: (id: string) => void
  onShowOutput: (id: string) => void
}): ReactElement {
  if (rows.length === 0) return <div className="dshw-panel"><p className="dshw-empty-body">No background jobs.</p></div>
  return (
    <div className="dshw-panel">
      <ul className="dshw-rows">
        {rows.map((row) => (
          <li key={row.id} className="dshw-row">
            <span className={`dshw-state dshw-state--${row.state}`}>{row.state}</span>
            <span className="dshw-row-path">{row.label}</span>
            <span className="dshw-detail">{row.startedAt}</span>
            {row.actions.map((action) => (
              <button
                key={action.kind}
                type="button"
                className="dshw-row-action"
                aria-label={`${action.kind === 'cancel' ? 'Cancel' : 'Show output for'} ${row.label}`}
                onClick={() => (action.kind === 'cancel' ? onCancel(action.id) : onShowOutput(action.id))}
              >
                {action.kind === 'cancel' ? 'cancel' : 'output'}
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Render the subagents panel.
 * @param props - Subagent rows and the transcript handler.
 * @returns The panel.
 */
export function SubagentsPanel({ rows, onOpenTranscript }: {
  rows: readonly SubagentRow[]
  onOpenTranscript: (id: string) => void
}): ReactElement {
  if (rows.length === 0) return <div className="dshw-panel"><p className="dshw-empty-body">No subagents in this session.</p></div>
  return (
    <div className="dshw-panel">
      <ul className="dshw-rows">
        {rows.map((row) => (
          <li key={row.id} className="dshw-row">
            <span className={`dshw-state dshw-state--${row.state}`}>{row.state}</span>
            <span className="dshw-row-path">{row.label}</span>
            <span className="dshw-detail">{row.mode}</span>
            {/* A subagent running a different mode from its parent is the case
                someone reading this panel is most likely to be surprised by. */}
            {row.modeNote !== null && <span className="dshw-row-warning">{row.modeNote}</span>}
            {row.actions.map((action) => (
              <button
                key={action.kind}
                type="button"
                className="dshw-row-action"
                aria-label={`Open transcript for ${row.label}`}
                onClick={() => onOpenTranscript(action.id)}
              >
                transcript
              </button>
            ))}
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * Render the attention panel.
 * @param props - Attention items, already ordered most urgent first.
 * @returns The panel.
 */
export function AttentionPanel({ items }: { items: readonly AttentionItem[] }): ReactElement {
  if (items.length === 0) {
    return (
      <div className="dshw-panel">
        <p className="dshw-empty-body">Nothing needs attention.</p>
        <p className="dshw-scope-note">
          This lists what the workbench can observe. It is not a statement that the work is correct.
        </p>
      </div>
    )
  }
  return (
    <div className="dshw-panel">
      <ul className="dshw-rows">
        {items.map((item) => (
          <li key={item.id} className={`dshw-row dshw-row--${item.severity}`}>
            <span className={`dshw-severity dshw-severity--${item.severity}`}>{item.severity}</span>
            <span>{item.message}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}
