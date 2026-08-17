/**
 * The workbench view tab.
 *
 * Occupies one entry in the official `conversation.view` ring, so the workbench
 * is a view the user switches to alongside chat and trajectory rather than a
 * surface that displaces one. The ring renders one entry at a time, which means
 * this component costs nothing while another view is active.
 *
 * When the Host capability is not reachable, every panel renders an explicit
 * unavailable state naming the reason. It never renders an empty list in place
 * of unknown data: "no changes" and "could not read the repository" look
 * identical on screen and mean opposite things.
 * @module @dsh-foundry/daily-workbench/client/WorkbenchHost
 */
import { useEffect, useState, type ReactElement } from 'react'
import type { BoundedResult, PathCandidate, SearchHit } from '../discovery.ts'
import type { GitDiff, GitInspection } from '../git.ts'
import type { ChangeProjection, DurableEvent } from '../projection.ts'
import { REVIEW_SCOPE_NOTE, buildReviewView, type ReviewView } from './review-view.ts'
import {
  buildContextView,
  buildJobRows,
  buildSubagentRows,
  buildVerificationView,
  collectAttention,
} from './status-views.ts'
import { attentionFromSnapshot, contextFromNodes, evidenceFromNodes, type SnapshotFacts } from './snapshot.ts'
import { USER_AUTHORITY_WARNING } from '@dsh-foundry/daily-contract'
import type { ProfileRows } from './panels/PluginsPanel.tsx'
import { unwrapRemote, type RemoteAnswer } from './reference-source.ts'
import { Workbench, type WorkbenchData } from './panels/Workbench.tsx'

/**
 * The Host face this view consumes.
 *
 * Every method resolves to a {@link RemoteAnswer} envelope rather than to its
 * payload, because that is what the official client Remote produces: it does
 * not reject, so a transport failure, a withdrawn mount, and a Host exception
 * all arrive as `{ok: false}`. Declaring the payload directly type-checks and
 * then reads fields off the envelope at runtime.
 */
export interface WorkbenchRemoteFace {
  /**
   * Find workspace paths matching a query.
   * @param session - Session whose workspace the answer is confined to.
   * @param query - Fuzzy path query.
   * @returns Ranked candidates, reporting any truncation.
   */
  findPaths(session: string, query: string): Promise<RemoteAnswer<BoundedResult<PathCandidate>>>
  /**
   * Search workspace text.
   * @param session - Session whose workspace the answer is confined to.
   * @param query - Literal text to find.
   * @returns Hits, reporting any truncation.
   */
  searchText(session: string, query: string): Promise<RemoteAnswer<BoundedResult<SearchHit>>>
  /**
   * Read repository status.
   * @param session - Session whose workspace is inspected.
   * @returns The inspection, or why the workspace has none.
   */
  inspectRepository(session: string): Promise<RemoteAnswer<GitInspection>>
  /**
   * Read a diff.
   * @param session - Session whose workspace the diff is read from.
   * @param options - Staged selection and an optional path.
   * @returns The diff.
   */
  readDiff(
    session: string,
    options?: { readonly staged?: boolean, readonly path?: string },
  ): Promise<RemoteAnswer<GitDiff>>
  /**
   * Attribute working-tree changes.
   * @param session - Session whose workspace is correlated.
   * @param events - Durable session events.
   * @returns The projection.
   */
  projectChanges(session: string, events: readonly DurableEvent[]): Promise<RemoteAnswer<ChangeProjection>>
  /**
   * List installed plugins with their provenance.
   * @returns One entry per installed package, per profile.
   */
  listPlugins(): Promise<RemoteAnswer<readonly ProfileRows[]>>
}

/** One running tool call, as the official conversation snapshot reports it. */
export interface RunningCall {
  readonly callId: string
  readonly name: string
  /** Unix epoch ms when the `tool/call` event was logged. */
  readonly time: number
}

/**
 * Turn running tool calls into job rows.
 *
 * Every call the snapshot still lists is running by definition — a settled call
 * leaves this collection. Nothing is marked `succeeded` or `failed` here,
 * because this source cannot see an outcome and inventing one would put a
 * verdict on screen that no record supports.
 * @param calls - Running calls from the conversation snapshot.
 * @returns Job records.
 */
export function jobsFromRunningCalls(calls: readonly RunningCall[]): {
  readonly id: string
  readonly label: string
  readonly state: 'running'
  readonly startedAt: string
  readonly cancellable: boolean
}[] {
  return calls.map((call) => ({
    id: call.callId,
    label: call.name,
    startedAt: new Date(call.time).toISOString(),
    state: 'running' as const,
    // No cancel path reaches a tool call from this view, and a button that does
    // nothing is worse than no button.
    cancellable: false,
  }))
}

/** What the view tab receives. */
export interface WorkbenchHostProps {
  /** The Host face, or `undefined` when the capability is not mounted. */
  readonly remote?: WorkbenchRemoteFace
  /**
   * The session this view belongs to.
   *
   * Passed to every workspace-scoped call: the Host resolves it to a directory
   * through the official registry, so one Host serves every open workspace and
   * this view can never read a tree the session does not belong to.
   */
  readonly sessionId?: string
  /** Durable session events, used to attribute changes. */
  readonly events?: readonly DurableEvent[]
  /** The official conversation snapshot, source of every non-Host panel. */
  readonly snapshot?: SnapshotFacts
}

/** What the review half produced. */
type ReviewState =
  | { readonly status: 'loading' }
  | { readonly status: 'ready', readonly view: ReviewView, readonly projection: ChangeProjection }
  | { readonly status: 'unavailable', readonly reason: string }

/** Why repository review needs a Host, phrased for the panel. */
export const HOST_UNAVAILABLE_REASON =
  'Repository review needs the workbench Host capability, which has not mounted in this window. '
  + 'It is served by the @dsh-foundry/daily-workbench plugin over the official gateway; a profile missing that '
  + 'plugin, or a window opened before it finished mounting, sees this. Reopening the window is the usual repair. '
  + 'Every other panel here reads the official session snapshot and is unaffected.'

/**
 * Render the workbench view tab.
 *
 * Panels split by data source. Checks, Context, Jobs, and Attention derive from
 * the official conversation snapshot and work with no capability mounted;
 * Changes needs the Host. Keeping them separate means a Host that is not
 * reachable costs one panel rather than the whole view.
 * @param props - The Host face and the official snapshot facts.
 * @returns The view.
 */
export function WorkbenchHost({
  remote,
  sessionId,
  events = [],
  snapshot,
}: WorkbenchHostProps): ReactElement {
  const [review, setReview] = useState<ReviewState>({ status: 'loading' })
  const [plugins, setPlugins] = useState<readonly ProfileRows[] | null>(null)
  const [pluginsUnavailable, setPluginsUnavailable] = useState<string | null>(null)

  useEffect(() => {
    if (remote === undefined) {
      setPluginsUnavailable(HOST_UNAVAILABLE_REASON)
      return
    }
    let live = true
    void remote.listPlugins().then(
      (answer) => {
        if (!live) return
        if (answer.ok) setPlugins(answer.value)
        else setPluginsUnavailable(answer.error.message ?? 'the plugin inventory call did not succeed')
      },
      (error: unknown) => {
        if (live) setPluginsUnavailable(error instanceof Error ? error.message : String(error))
      },
    )
    return () => {
      live = false
    }
  }, [remote])

  useEffect(() => {
    if (remote === undefined || sessionId === undefined) {
      setReview({ status: 'unavailable', reason: HOST_UNAVAILABLE_REASON })
      return
    }
    let live = true
    void (async () => {
      try {
        const inspection = unwrapRemote(await remote.inspectRepository(sessionId), 'inspectRepository')
        const projection = unwrapRemote(await remote.projectChanges(sessionId, events), 'projectChanges')
        if (live) setReview({ status: 'ready', view: buildReviewView(inspection, projection), projection })
      } catch (error) {
        if (live) {
          setReview({ status: 'unavailable', reason: error instanceof Error ? error.message : String(error) })
        }
      }
    })()
    return () => {
      live = false
    }
  }, [remote, sessionId, events])

  const facts: SnapshotFacts = snapshot ?? {
    nodes: [], runningCalls: [], removed: false, lastAgentError: null, subagent: null,
  }

  const verification = buildVerificationView(
    evidenceFromNodes(facts.nodes),
    review.status === 'ready' ? review.projection.evidenceIsStale : false,
  )
  const context = buildContextView(contextFromNodes(facts.nodes), false)
  const jobs = buildJobRows(jobsFromRunningCalls(facts.runningCalls))
  const subagents = buildSubagentRows([], 'daily')

  const reviewView: ReviewView = review.status === 'ready'
    ? review.view
    : {
      repository: null,
      unavailable: review.status === 'loading' ? 'Reading the repository…' : review.reason,
      sections: [],
      claimedButAbsent: [],
      evidenceWarning: null,
      actions: [],
      scopeNote: REVIEW_SCOPE_NOTE,
    }

  const data: WorkbenchData = {
    review: reviewView,
    verification,
    context,
    jobs,
    subagents,
    plugins,
    pluginsUnavailable,
    authorityWarning: USER_AUTHORITY_WARNING,
    attention: [
      ...attentionFromSnapshot(facts),
      ...collectAttention({
        conflictedPaths: reviewView.sections
          .filter((section) => section.state === 'conflicted')
          .flatMap((section) => section.rows.map((row) => row.path)),
        failingChecks: verification.rows.filter((row) => row.outcome === 'fail').map((row) => row.command),
        evidenceIsStale: review.status === 'ready' ? review.projection.evidenceIsStale : false,
        claimedButAbsent: reviewView.claimedButAbsent,
        failedJobs: jobs.filter((job) => job.state === 'failed'),
        failedSubagents: subagents.filter((agent) => agent.state === 'failed'),
      }),
    ],
  }

  return (
    <Workbench
      data={data}
      handlers={{
        onReviewAction: () => {},
        onCompact: () => {},
        onCancelJob: () => {},
        onShowJobOutput: () => {},
        onOpenTranscript: () => {},
      }}
    />
  )
}
