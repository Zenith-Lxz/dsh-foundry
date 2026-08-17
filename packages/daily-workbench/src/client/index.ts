/**
 * Workbench plugin, browser half — public entry.
 *
 * A plain `.ts` barrel because the typert generator resolves the `./client`
 * export to `src/client/index.ts` exactly; the JSX body lives in
 * [plugin](./plugin.tsx).
 * @module @dsh-foundry/daily-workbench/client
 */
export { apply, inject } from './plugin.tsx'
export { Workbench, badgeFor } from './panels/Workbench.tsx'
export type { WorkbenchData, WorkbenchHandlers } from './panels/Workbench.tsx'
export { ReviewPanel } from './panels/ReviewPanel.tsx'
export { SearchPanel } from './panels/SearchPanel.tsx'
export {
  AttentionPanel,
  ContextPanel,
  JobsPanel,
  SubagentsPanel,
  VerificationPanel,
} from './panels/StatusPanels.tsx'
export { HOST_UNAVAILABLE_REASON, WorkbenchHost, jobsFromRunningCalls } from './WorkbenchHost.tsx'
export { WorkbenchView, selectFacts } from './WorkbenchView.tsx'
export {
  attentionFromSnapshot,
  commandOf,
  contextFromNodes,
  evidenceFromNodes,
} from './snapshot.ts'
export type { SnapshotFacts } from './snapshot.ts'
export type { RunningCall, WorkbenchHostProps, WorkbenchRemoteFace } from './WorkbenchHost.tsx'
export { MOUNT_PLAN, OFFICIAL_SLOT_KINDS, WORKBENCH_SLOTS } from './mount.ts'
