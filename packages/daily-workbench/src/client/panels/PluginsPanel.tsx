/**
 * The plugins panel.
 *
 * Answers the question the official list cannot: who shipped each package, did
 * anyone review it, and what does turning it off cost. Searching the official
 * list for `daily` or `foundry` returns nothing even when those packages are
 * installed and running, because the runtime carries no provenance.
 *
 * Two display rules follow from how the provenance is derived:
 *
 * - **`unknown` renders as unknown**, in the same weight as any other source. A
 *   row shown without a source reads as unremarkable, and unremarkable is the
 *   wrong impression for a package nothing vouched for.
 * - **The authority warning is attached to every unreviewed row**, not shown
 *   once at the top. A user scrolling to one row should not have to remember a
 *   banner they scrolled past.
 * @module @dsh-foundry/daily-workbench/client/panels/PluginsPanel
 */
import { useState, type ReactElement } from 'react'
import type { PluginProvenance, ProvenanceSource } from '@dsh-foundry/daily-contract'

/** One profile's rows. */
export interface ProfileRows {
  readonly profile: string
  readonly entries: readonly PluginProvenance[]
}

/** What the plugins panel needs. */
export interface PluginsPanelProps {
  readonly inventory: readonly ProfileRows[] | null
  /** Why the inventory is unavailable, when it is. */
  readonly unavailable: string | null
  /** Shown against every row this distribution did not review. */
  readonly authorityWarning: string
}

/** How each source reads in the list. */
const SOURCE_LABEL: Record<ProvenanceSource, string> = {
  official: 'Official DSH',
  foundry: 'DSH Foundry',
  user: 'User',
  workspace: 'Workspace',
  unknown: 'Unknown',
}

/**
 * Filter rows by a query across every visible field.
 * @param rows - All rows.
 * @param query - Search text.
 * @returns Matching rows.
 */
export function filterRows(rows: readonly PluginProvenance[], query: string): PluginProvenance[] {
  const needle = query.trim().toLowerCase()
  if (needle === '') return [...rows]
  return rows.filter((row) => [
    row.packageName,
    row.displayName,
    SOURCE_LABEL[row.source],
    row.source,
    row.bundle ?? '',
    row.profile,
  ].some((field) => field.toLowerCase().includes(needle)))
}

/**
 * Render the plugins panel.
 * @param props - Inventory, availability, and the authority warning.
 * @returns The panel.
 */
export function PluginsPanel({ inventory, unavailable, authorityWarning }: PluginsPanelProps): ReactElement {
  const [query, setQuery] = useState('')

  if (unavailable !== null) {
    return (
      <div className="dshw-panel dshw-panel--empty">
        <p className="dshw-empty-title">Plugin inventory unavailable</p>
        <p className="dshw-empty-body">{unavailable}</p>
      </div>
    )
  }
  if (inventory === null) {
    return <div className="dshw-panel"><p className="dshw-empty-body">Reading installed plugins…</p></div>
  }

  const all = inventory.flatMap((profile) => profile.entries)
  const matching = filterRows(all, query)

  return (
    <div className="dshw-panel">
      <label className="dshw-search-label">
        <span className="dshw-visually-hidden">Filter plugins</span>
        <input
          type="search"
          className="dshw-search-input"
          placeholder="Filter by name, source, profile, or bundle"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
      </label>
      <p className="dshw-detail">
        {matching.length} of {all.length} plugin{all.length === 1 ? '' : 's'}
        {query.trim() === '' ? '' : ` matching “${query.trim()}”`}
      </p>

      {matching.length === 0
        ? <p className="dshw-empty-body">No plugin matches that filter.</p>
        : inventory.map((profile) => {
          const rows = filterRows(profile.entries, query)
          if (rows.length === 0) return null
          return (
            <section key={profile.profile} className="dshw-section">
              <h3 className="dshw-section-title">
                {profile.profile}
                <span className="dshw-count">{rows.length}</span>
              </h3>
              <ul className="dshw-rows">
                {rows.map((row) => (
                  <li key={`${profile.profile}/${row.packageName}`} className="dshw-plugin-row">
                    <div className="dshw-plugin-head">
                      <span className={`dshw-source dshw-source--${row.source}`}>{SOURCE_LABEL[row.source]}</span>
                      <span className="dshw-row-path" title={row.packageName}>{row.packageName}</span>
                      <span className="dshw-detail">{row.version}</span>
                      {row.foundryVerified && <span className="dshw-verified">Foundry verified</span>}
                    </div>
                    <p className="dshw-detail">
                      {row.bundle === null ? 'mounted directly' : `via ${row.bundle}`}
                      {' · '}
                      {row.disableable ? 'can be turned off' : 'required'}
                      {row.evidence === null
                        ? ' · no metadata declared its source'
                        : ` · source from ${row.evidence.field}`}
                    </p>
                    <p className="dshw-detail">{row.disableImpact}</p>
                    {/* Attached per row rather than shown once: someone reading
                        one row should not have to remember a banner above. */}
                    {!row.foundryVerified && row.source !== 'official' && (
                      <p className="dshw-row-warning">{authorityWarning}</p>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )
        })}

      <p className="dshw-scope-note">
        This lists what is installed and who shipped it. It does not execute plugin code, so it reports composition
        rather than behavior — a package with no findings here has not been shown to be safe.
      </p>
    </div>
  )
}
