/**
 * The workbench Remote surface.
 *
 * One narrow gateway over the Host capability, exposed through the official
 * Typert Remote mechanism so the browser reaches it on the same HTTP/WebSocket
 * transport as every other Harness call. Nothing here goes near Electron IPC:
 * the workbench must work in the official browser client, and a desktop-only
 * path would make the browser profile second class.
 *
 * **What this deliberately does not expose.** There is no `readFile`, no
 * `writeFile`, no `exec`, no `spawn`, and no environment access. A generic
 * filesystem or process Remote would hand the browser an authority the agent's
 * own tools obtain only through the official permission flow, and it would do
 * so with no approval surface at all. Every method below answers a bounded
 * question about the workspace and returns data the caller already may see.
 *
 * Mutation stays where it belongs: the agent edits through official tools under
 * official permissions, and Git stays read-only here.
 * @module @dsh-foundry/daily-workbench/gateway
 */
import type { BoundedResult, PathCandidate, SearchHit, TraversalOptions } from './discovery.ts'
import { findPaths, searchText } from './discovery.ts'
import type { GitDiff, GitInspection } from './git.ts'
import { inspectRepository, readDiff } from './git.ts'
import type { ChangeProjection, DurableEvent } from './projection.ts'
import { projectChanges } from './projection.ts'
import { WorkspaceScope } from './workspace.ts'

/** Caller-supplied bounds, narrowed before they reach a traversal. */
export interface WorkbenchRequestLimits {
  readonly maxResults?: number
  readonly timeBudgetMs?: number
}

/**
 * Ceilings a caller cannot raise.
 *
 * A client may ask for *less* work than the default, never more: without a
 * ceiling, one request could pin the Host process for an arbitrary time, and
 * the Host serves every session in the deployment.
 */
const REQUEST_CEILINGS = { maxResults: 500, timeBudgetMs: 5_000 } as const

/**
 * Clamp caller-supplied limits into the permitted range.
 * @param limits - Requested limits, if any.
 * @returns Limits safe to hand to a traversal.
 */
function clampLimits(limits: WorkbenchRequestLimits | undefined): TraversalOptions['limits'] {
  if (limits === undefined) return undefined
  const clamped: { maxResults?: number, timeBudgetMs?: number } = {}
  if (typeof limits.maxResults === 'number' && limits.maxResults > 0) {
    clamped.maxResults = Math.min(limits.maxResults, REQUEST_CEILINGS.maxResults)
  }
  if (typeof limits.timeBudgetMs === 'number' && limits.timeBudgetMs > 0) {
    clamped.timeBudgetMs = Math.min(limits.timeBudgetMs, REQUEST_CEILINGS.timeBudgetMs)
  }
  return clamped
}

/**
 * The workbench capability, bound to one active workspace.
 *
 * Declared as a plain class rather than extending the official Remote base
 * directly, so the capability is unit-testable without a Host and the plugin
 * body owns the one line that publishes it. The published subclass lives in the
 * plugin entry.
 */
export class WorkbenchCapability {
  readonly #scope: WorkspaceScope

  /**
   * @param workspaceRoot - Absolute path of the active workspace.
   */
  constructor(workspaceRoot: string) {
    this.#scope = new WorkspaceScope(workspaceRoot)
  }

  /**
   * Find workspace files and directories matching a fuzzy query.
   * @param query - Fuzzy path query; empty lists the workspace within bounds.
   * @param limits - Optional caller bounds, clamped to the permitted ceilings.
   * @returns Ranked, bounded candidates that report their own truncation.
   */
  findPaths(query: string, limits?: WorkbenchRequestLimits): BoundedResult<PathCandidate> {
    const clamped = clampLimits(limits)
    return findPaths(this.#scope, String(query ?? ''), clamped === undefined ? {} : { limits: clamped })
  }

  /**
   * Search file contents for a literal string.
   * @param query - Literal text; an empty query returns nothing rather than everything.
   * @param limits - Optional caller bounds, clamped to the permitted ceilings.
   * @returns Bounded hits with line numbers and previews.
   */
  searchText(query: string, limits?: WorkbenchRequestLimits): BoundedResult<SearchHit> {
    const clamped = clampLimits(limits)
    return searchText(this.#scope, String(query ?? ''), clamped === undefined ? {} : { limits: clamped })
  }

  /**
   * Inspect repository identity and working-tree status.
   * @returns The inspection, or the reason Git is unavailable.
   */
  async inspectRepository(): Promise<GitInspection> {
    return inspectRepository(this.#scope)
  }

  /**
   * Render a textual diff.
   * @param options - Which changes to render and an optional path filter.
   * @returns The diff text and whether it was truncated.
   */
  async readDiff(options?: { readonly staged?: boolean, readonly path?: string }): Promise<GitDiff> {
    return readDiff(this.#scope, options ?? {})
  }

  /**
   * Correlate a session's durable record with the current repository state.
   *
   * The caller supplies the events because the session log is the official
   * runtime's to own; this method adds only the correlation, and never treats
   * assistant prose as evidence.
   * @param events - Durable session events, oldest first.
   * @returns Change attribution and verification evidence.
   */
  async projectChanges(events: readonly DurableEvent[]): Promise<ChangeProjection> {
    const inspection = await inspectRepository(this.#scope)
    const status = inspection.available ? inspection.entries : []
    return projectChanges(events ?? [], status, this.#scope.root)
  }
}
