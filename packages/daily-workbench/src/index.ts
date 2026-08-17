/**
 * Workbench plugin, Host half.
 *
 * Publishes {@link WorkbenchCapability} through the official Typert Gateway, so
 * the browser reaches it over the same HTTP transport as every other Harness
 * call. Nothing here touches Electron: the desktop shell owns window operations
 * and never carries workbench data, which `gate:coupling` enforces.
 *
 * The exported surface is exactly five methods, all read-only. There is no
 * generic filesystem or process Remote: a capability that could read any path
 * or spawn any command would make the workspace-root containment in
 * {@link WorkspaceScope} decorative, since a caller could simply ask for
 * something else.
 * @module @dsh-foundry/daily-workbench
 */
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { Context } from '@deepseek-ai/cordis'
import type { BoundedResult, PathCandidate, SearchHit } from './discovery.ts'
import type { GitDiff, GitInspection } from './git.ts'
import type { ChangeProjection, DurableEvent } from './projection.ts'
import { harnessHome, inventoryHome, type ProfileInventory } from '@dsh-foundry/plugin-governance'
import { WorkbenchCapability, type WorkbenchRequestLimits } from './gateway.ts'

export { DEFAULT_EXCLUDED_DIRECTORIES, DEFAULT_LIMITS, findPaths, searchText } from './discovery.ts'
export type {
  BoundedResult,
  PathCandidate,
  SearchHit,
  TraversalLimits,
  TraversalOptions,
  TruncationReason,
} from './discovery.ts'
export { READ_ONLY_SUBCOMMANDS } from './git.ts'
export type { GitDiff, GitInspection, GitOverview, GitStatusEntry, GitUnavailable } from './git.ts'
export { isVerificationCommand, projectChanges } from './projection.ts'
export type { AttributedChange, ChangeAttribution, ChangeProjection, DurableEvent } from './projection.ts'
export { WorkbenchCapability } from './gateway.ts'
export type { WorkbenchRequestLimits } from './gateway.ts'
export { toPosix } from './workspace.ts'
export type { ContainmentFailure, ContainmentResult } from './workspace.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The workbench Host face, reached by the browser over the official Typert Gateway. */
    dshWorkbench: WorkbenchRemoteService
  }
}

/** Plugin configuration. */
export interface WorkbenchConfig {
  /**
   * Absolute root that overrides the per-session lookup.
   *
   * Left unset in every shipped profile: the workspace is a per-session choice
   * the official registry already records, and pinning one here would make a
   * second opened workspace answer about the first. It exists for a
   * single-workspace deployment that wants the root fixed by configuration.
   */
  readonly workspaceRoot?: string
}

/**
 * The part of an official Session this plugin reads.
 *
 * A parameter named `session` is resolved by the official lookup the session
 * store registers (`wire: 'sessionId'`), so the Gateway hands this Host a real
 * Session and rejects an id no session store knows — the containment check
 * happens in the runtime that owns sessions rather than here.
 */
export interface SessionLike {
  readonly header: { readonly cwd?: string }
}

/**
 * How a session is turned into the directory its answers are confined to.
 *
 * A function rather than a fixed root, because one Host serves every session in
 * the deployment and the user picks a workspace per session at run time. A root
 * fixed at mount is wrong the moment a second workspace is opened, and for the
 * packaged application it was wrong immediately: the desktop shell spawns the
 * Host with the **home directory** as its working directory, so the former
 * `?? process.cwd()` default scoped every answer to the user's whole home.
 */
export type WorkspaceResolver = (session: SessionLike) => string | undefined

/**
 * Resolve a session's workspace from the session itself.
 *
 * `header.cwd` is the session's own validated absolute directory — the
 * workspace the user chose when the session was created. Reading it needs no
 * second registry and cannot disagree with the session the call arrived for.
 * The client sends only its session id, so a caller cannot widen its own scope
 * by asking, which is what keeps the containment in {@link WorkspaceScope}
 * meaningful rather than decorative.
 * @param config - Plugin configuration; an explicit root overrides the lookup.
 * @returns The resolver the Remote face uses.
 */
export function workspaceResolver(config: WorkbenchConfig): WorkspaceResolver {
  const configured = config.workspaceRoot
  if (configured !== undefined && configured.length > 0) return () => configured
  return (session) => {
    const cwd = session.header.cwd
    return cwd !== undefined && cwd.length > 0 ? cwd : undefined
  }
}

/**
 * The Remote face.
 *
 * Each method delegates to the capability rather than reimplementing it, so the
 * containment and bounding rules hold identically whether a caller arrives over
 * the wire or constructs the capability directly in a test.
 *
 * **No `#private` field may back a Remote method.** The Gateway invokes a
 * Remote with `this` bound to the Cordis *service proxy*, not to this instance,
 * and an ECMAScript private field is reachable only from the object whose class
 * declared it. A method reading one throws `Cannot read private member … from
 * an object whose class did not declare it` at call time — after dispatch has
 * already succeeded, so the failure surfaces as a business error rather than as
 * a missing endpoint. No official Remote face uses `#private` either.
 * @typert service dshWorkbench
 */
export class WorkbenchRemoteService extends TypertRemoteService {
  // TypeScript-private, not `#private`: see the class contract above.
  private readonly resolve: WorkspaceResolver
  private readonly capabilities = new Map<string, WorkbenchCapability>()

  /**
   * @param ctx - Owning Cordis context.
   * @param resolve - Turns a session into the directory to confine it to.
   */
  constructor(ctx: Context, resolve: WorkspaceResolver) {
    super(ctx, 'dshWorkbench')
    this.resolve = resolve
  }

  /**
   * The capability confined to one session's workspace.
   *
   * Cached per resolved directory, because a traversal builds no state worth
   * rebuilding per call and two sessions in one workspace should share it.
   * @param session - Session the call arrived for.
   * @returns The capability for that session's workspace.
   * @throws When the session has no registered workspace, which is a caller
   * error rather than an empty result: answering `[]` would read as "this
   * workspace has no files".
   */
  private scoped(session: SessionLike): WorkbenchCapability {
    const root = this.resolve(session)
    if (root === undefined) {
      throw new Error(
        'daily-workbench: this session records no workspace directory, '
        + 'so there is no tree to answer about',
      )
    }
    const existing = this.capabilities.get(root)
    if (existing !== undefined) return existing
    const capability = new WorkbenchCapability(root)
    this.capabilities.set(root, capability)
    return capability
  }

  /**
   * Find workspace paths matching a query.
   * @param session - Session whose workspace the answer is confined to.
   * @param query - Fuzzy path query.
   * @param limits - Caller-requested bounds, clamped to the ceilings.
   * @returns Ranked candidates, reporting any truncation.
   */
  @Remote
  findPaths(session: SessionLike, query: string, limits?: WorkbenchRequestLimits): BoundedResult<PathCandidate> {
    return this.scoped(session).findPaths(query, limits)
  }

  /**
   * Search workspace text.
   * @param session - Session whose workspace the answer is confined to.
   * @param query - Literal text to find.
   * @param limits - Caller-requested bounds, clamped to the ceilings.
   * @returns Hits grouped by the caller, reporting any truncation.
   */
  @Remote
  searchText(session: SessionLike, query: string, limits?: WorkbenchRequestLimits): BoundedResult<SearchHit> {
    return this.scoped(session).searchText(query, limits)
  }

  /**
   * Read repository status.
   * @param session - Session whose workspace is inspected.
   * @returns The inspection, or why the workspace has none.
   */
  @Remote
  async inspectRepository(session: SessionLike): Promise<GitInspection> {
    return this.scoped(session).inspectRepository()
  }

  /**
   * Read a diff.
   * @param session - Session whose workspace the diff is read from.
   * @param options - Staged selection and an optional path.
   * @returns The diff.
   */
  @Remote
  async readDiff(session: SessionLike, options?: { readonly staged?: boolean, readonly path?: string }): Promise<GitDiff> {
    return this.scoped(session).readDiff(options)
  }

  /**
   * Attribute working-tree changes to the session or to something outside it.
   * @param session - Session whose workspace is correlated.
   * @param events - Durable session events.
   * @returns The projection.
   */
  @Remote
  async projectChanges(session: SessionLike, events: readonly DurableEvent[]): Promise<ChangeProjection> {
    return this.scoped(session).projectChanges(events)
  }

  /**
   * List installed plugins with their provenance.
   *
   * Read from the Harness home rather than from the runtime, because the
   * question is who shipped a package and whether anyone reviewed it — which is
   * distribution knowledge the runtime does not carry, and why searching the
   * official list for this distribution's packages returns nothing.
   * @returns One entry per installed package, per profile.
   */
  @Remote
  listPlugins(): readonly ProfileInventory[] {
    return inventoryHome(harnessHome())
  }
}

/**
 * Mount the workbench Host.
 * @param ctx - Owning Cordis context.
 * @param config - The workspace root to confine requests to.
 */
export function apply(ctx: Context, config: WorkbenchConfig = {}): void {
  ctx.effect(() => {
    const service = new WorkbenchRemoteService(ctx, workspaceResolver(config))
    return () => void service
  })
}
