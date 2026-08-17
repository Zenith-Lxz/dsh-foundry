/**
 * Search results.
 *
 * The truncation notice is rendered as prominently as the results themselves,
 * because the dangerous reading of a bounded search is the silent one: a file
 * missing from a time-limited result has not been shown to lack a match, and a
 * reader who does not know the walk stopped early will conclude that it does.
 *
 * Excluded directories are disclosed for the same reason. `node_modules` not
 * appearing is correct; not knowing it was never searched is not.
 * @module @dsh-foundry/daily-workbench/client/panels/SearchPanel
 */
import type { ReactElement } from 'react'
import type { SearchView } from '../search-view.ts'

/** What the search panel needs. */
export interface SearchPanelProps {
  readonly view: SearchView
  /** True when the results describe an older query than the one in the box. */
  readonly stale: boolean
  /** Open a result at its line. */
  readonly onOpen: (path: string, line: number) => void
}

/**
 * Render search results.
 * @param props - The view model, staleness, and the open handler.
 * @returns The panel.
 */
export function SearchPanel({ view, stale, onOpen }: SearchPanelProps): ReactElement {
  return (
    <div className="dshw-panel dshw-search">
      <header className="dshw-search-header">
        <span className="dshw-detail">
          {view.totalMatches} match{view.totalMatches === 1 ? '' : 'es'} in {view.groups.length} file
          {view.groups.length === 1 ? '' : 's'}
        </span>
        {/* Shown rather than hidden: results for a query the user has already
            moved past look identical to current ones. */}
        {stale && <span className="dshw-stale">results are for “{view.query}”</span>}
      </header>

      {view.truncation !== null && (
        <p className="dshw-warning" role="status">{view.truncation.message}</p>
      )}

      {view.empty
        ? <p className="dshw-empty-body">No matches.</p>
        : (
          <ul className="dshw-groups">
            {view.groups.map((group) => (
              <li key={group.path} className="dshw-group">
                <h4 className="dshw-group-path">{group.path}</h4>
                <ul className="dshw-matches">
                  {group.matches.map((match) => (
                    <li key={`${group.path}:${match.line}`}>
                      <button
                        type="button"
                        className="dshw-match"
                        // The visible text is a code fragment; the accessible
                        // name has to say where opening it lands.
                        aria-label={`Open ${group.path} at line ${match.line}`}
                        onClick={() => onOpen(group.path, match.line)}
                      >
                        <span className="dshw-line">{match.line}</span>
                        <code className="dshw-preview">{match.preview}</code>
                      </button>
                    </li>
                  ))}
                </ul>
                {group.hiddenMatches > 0 && (
                  <p className="dshw-detail">
                    {group.hiddenMatches} more match{group.hiddenMatches === 1 ? '' : 'es'} in this file
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}

      {view.excludedDirectories.length > 0 && (
        <p className="dshw-scope-note">
          Not searched: {view.excludedDirectories.join(', ')}.
        </p>
      )}
    </div>
  )
}
