/**
 * The slot occupant.
 *
 * Separated from {@link WorkbenchHost} so the panel tree stays a pure function
 * of its data and can be tested without the framework's hooks. This file is the
 * only place that touches the official session kit.
 * @module @dsh-foundry/daily-workbench/client/WorkbenchView
 */
import { useSyncExternalStore, type ReactElement } from 'react'
import type { ComposedProps } from '@deepseek-ai/dsh-client-ui-slots'
// Type-only: merges the SlotMap entry and the runtime's session standard kit,
// so `useSession` is the framework's real hook rather than a local restatement.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SnapshotFacts } from './snapshot.ts'
import type { RemoteHolder } from './remote-holder.ts'
import { WorkbenchHost, type WorkbenchRemoteFace } from './WorkbenchHost.tsx'

/**
 * The framework's composed props for this slot entry.
 *
 * Taken from the framework rather than hand-declared: a local restatement of
 * `useSession` compiles against itself and stops matching the moment the kit
 * changes shape.
 */
export type WorkbenchViewProps = ComposedProps<
  'conversation.view', string, never, undefined, object, never, undefined
>

/**
 * Read the snapshot fields the workbench derives its panels from.
 *
 * One selector rather than several: each `useSession` call subscribes
 * independently, and separate subscriptions would re-render the tab once per
 * changed field for data that is always rendered together.
 * @param snapshot - The official conversation snapshot.
 * @returns The fields the workbench reads.
 */
export function selectFacts(snapshot: {
  nodes: readonly { kind: string }[]
  runningCalls: readonly { callId: string, name: string, time: number }[]
  removed: boolean
  lastAgentError: string | null
  subagent: { parentAvailable: boolean } | null
}): SnapshotFacts {
  return {
    nodes: snapshot.nodes,
    runningCalls: snapshot.runningCalls,
    removed: snapshot.removed,
    lastAgentError: snapshot.lastAgentError,
    subagent: snapshot.subagent,
  }
}

/**
 * Render the workbench tab from the official session snapshot.
 *
 * The Host face arrives through {@link RemoteHolder} rather than off a `ctx`
 * prop. Reading `ctx.remote.dshWorkbench` here compiled and then returned
 * `undefined` at runtime — the slot's composed props carry no such field, and
 * even where one exists Cordis refuses the read from a fiber that did not
 * inject the namespace — so every panel reported the Host unreachable while it
 * was answering normally.
 * @param props - The framework-supplied session kit plus the Host face holder.
 * @returns The workbench.
 */
export function WorkbenchView({ useSession, sessionId, holder }: WorkbenchViewProps & {
  readonly holder: RemoteHolder<WorkbenchRemoteFace>
}): ReactElement {
  const facts: SnapshotFacts = useSession(selectFacts as never)
  // Subscribed rather than read once: the namespace mounts asynchronously, and
  // a tab opened first would otherwise stay on the unavailable state forever.
  const remote = useSyncExternalStore(holder.subscribe, holder.getSnapshot, holder.getSnapshot)
  // `sessionId` is the framework's own seat on a session-scoped slot, not
  // something this plugin resolves: the Host turns it into the workspace
  // directory, so the tab reads the tree its session belongs to and no other.
  return (
    <WorkbenchHost
      snapshot={facts}
      sessionId={sessionId}
      {...(remote === undefined ? {} : { remote })}
    />
  )
}
