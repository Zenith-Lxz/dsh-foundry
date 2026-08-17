/**
 * The workbench container.
 *
 * One tabbed surface rather than six separate slot entries, because the details
 * column is narrow and six stacked panels would each be too short to read. The
 * mount plan still names all six: the tabs are presentation, and each tab's
 * content is the view model the plan lists.
 *
 * Tab badges count only what is *actionable* — blocking attention items,
 * conflicted paths, failing checks — not row totals. A badge showing the number
 * of files in a repository is noise that trains people to ignore badges.
 * @module @dsh-foundry/daily-workbench/client/panels/Workbench
 */
import { useState, type ReactElement } from 'react'
import type { ReviewAction, ReviewView } from '../review-view.ts'
import type { AttentionItem, ContextView, JobRow, SubagentRow, VerificationView } from '../status-views.ts'
import { PluginsPanel, type ProfileRows } from './PluginsPanel.tsx'
import { ReviewPanel } from './ReviewPanel.tsx'
import { AttentionPanel, ContextPanel, JobsPanel, SubagentsPanel, VerificationPanel } from './StatusPanels.tsx'

/** Everything the workbench renders. */
export interface WorkbenchData {
  readonly review: ReviewView
  readonly verification: VerificationView
  readonly context: ContextView
  readonly jobs: readonly JobRow[]
  readonly subagents: readonly SubagentRow[]
  readonly attention: readonly AttentionItem[]
  /** Installed plugins with provenance; `null` while loading. */
  readonly plugins: readonly ProfileRows[] | null
  /** Why the inventory is unavailable, when it is. */
  readonly pluginsUnavailable: string | null
  /** Warning attached to every unreviewed plugin row. */
  readonly authorityWarning: string
}

/** What the workbench can dispatch. */
export interface WorkbenchHandlers {
  readonly onReviewAction: (action: ReviewAction) => void
  readonly onCompact: () => void
  readonly onCancelJob: (id: string) => void
  readonly onShowJobOutput: (id: string) => void
  readonly onOpenTranscript: (id: string) => void
}

/** Tab identities, matching the mount plan's panel ids. */
const TABS = ['review', 'verification', 'context', 'jobs', 'subagents', 'plugins', 'attention'] as const

/** One tab id. */
type TabId = (typeof TABS)[number]

/** Tab labels. */
const TAB_LABEL: Record<TabId, string> = {
  review: 'Changes',
  verification: 'Checks',
  context: 'Context',
  jobs: 'Jobs',
  subagents: 'Subagents',
  plugins: 'Plugins',
  attention: 'Attention',
}

/**
 * Count what a tab badge should show, or `null` for no badge.
 *
 * Only actionable counts qualify. A total that never drops to zero is not a
 * signal.
 * @param tab - The tab.
 * @param data - The rendered data.
 * @returns The badge count, or `null`.
 */
export function badgeFor(tab: TabId, data: WorkbenchData): number | null {
  const count = (() => {
    switch (tab) {
      case 'review':
        return data.review.sections
          .filter((section) => section.state === 'conflicted')
          .reduce((sum, section) => sum + section.rows.length, 0)
          + data.review.claimedButAbsent.length
      case 'verification':
        return data.verification.rows.filter((row) => row.outcome === 'fail').length
      case 'jobs':
        return data.jobs.filter((job) => job.state === 'running').length
      case 'attention':
        return data.attention.filter((item) => item.severity === 'blocking').length
      case 'plugins':
        // Only what the user has to weigh: packages running with their
        // authority that nobody vouched for. A count of every installed plugin
        // would never reach zero and would stop being read.
        return (data.plugins ?? []).flatMap((profile) => profile.entries)
          .filter((entry) => entry.source === 'unknown').length
      case 'context':
      case 'subagents':
        return 0
    }
  })()
  return count > 0 ? count : null
}

/**
 * Render the workbench.
 * @param props - Data and handlers.
 * @returns The workbench.
 */
export function Workbench({ data, handlers }: {
  data: WorkbenchData
  handlers: WorkbenchHandlers
}): ReactElement {
  const [active, setActive] = useState<TabId>('review')

  return (
    <div className="dshw-workbench">
      <div className="dshw-tabs" role="tablist" aria-label="Workbench">
        {TABS.map((tab) => {
          const badge = badgeFor(tab, data)
          return (
            <button
              key={tab}
              type="button"
              role="tab"
              className="dshw-tab"
              aria-selected={active === tab}
              onClick={() => setActive(tab)}
            >
              {TAB_LABEL[tab]}
              {badge !== null && <span className="dshw-tab-badge">{badge}</span>}
            </button>
          )
        })}
      </div>
      <div role="tabpanel" aria-label={TAB_LABEL[active]}>
        {active === 'review' && <ReviewPanel view={data.review} onAction={handlers.onReviewAction} />}
        {active === 'verification' && <VerificationPanel view={data.verification} />}
        {active === 'context' && <ContextPanel view={data.context} onCompact={handlers.onCompact} />}
        {active === 'jobs' && (
          <JobsPanel rows={data.jobs} onCancel={handlers.onCancelJob} onShowOutput={handlers.onShowJobOutput} />
        )}
        {active === 'subagents' && <SubagentsPanel rows={data.subagents} onOpenTranscript={handlers.onOpenTranscript} />}
        {active === 'plugins' && (
          <PluginsPanel
            inventory={data.plugins}
            unavailable={data.pluginsUnavailable}
            authorityWarning={data.authorityWarning}
          />
        )}
        {active === 'attention' && <AttentionPanel items={data.attention} />}
      </div>
    </div>
  )
}
