/**
 * Workbench plugin, browser half.
 *
 * Registers the panels into public official slots and nothing else. There is no
 * layout replacement here: the workbench is an occupant of slots the official
 * runtime declares, so it renders identically in a plain browser and inside the
 * desktop shell.
 *
 * Slot existence is proved by `probe:contracts` at qualification time, not
 * guessed here. `slots.entries()` returns empty both for an undeclared key and
 * for a declared-but-empty one, so a runtime pre-check could not tell a missing
 * upstream slot from an ordinary empty one — an absent slot must fail the build
 * rather than degrade the product silently.
 *
 * **No workbench data crosses Electron IPC.** Status, diffs, search, and
 * verification all travel the official Typert Remote over HTTP; `gate:coupling`
 * fails the build if any module here imports the desktop bridge. A hosting
 * shell contributes presentation affordance, never a capability.
 * @module @dsh-foundry/daily-workbench/client/plugin
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merges that declare the conversation slots the
// mount plan targets. Without them SlotMap knows only `root` and every
// register call below fails to typecheck against a key that exists at runtime.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  CANDIDATE_LIMIT,
  DEBOUNCE_MS,
  REFERENCE_SOURCE_NAME,
  REFERENCE_TRIGGER,
  isTruncationNotice,
  referenceCandidates,
  referenceCodec,
  referenceInsert,
  referenceNotice,
  unwrapRemote,
  type WorkbenchRemote,
} from './reference-source.ts'
import { WORKBENCH_REMOTE, WORKBENCH_SERVICE } from './remote-contract.ts'
import { WORKBENCH_SLOTS } from './mount.ts'
import { WorkbenchView } from './WorkbenchView.tsx'
import { createRemoteHolder } from './remote-holder.ts'
import type { WorkbenchRemoteFace } from './WorkbenchHost.tsx'
import { installWorkbenchStyles } from './panels/styles.ts'


/**
 * Required services.
 *
 * `remote` is the official client Remote capability and `inputTriggers` is the
 * official `@`/`/` menu seam.
 *
 * The mounted namespace `remote.dshWorkbench` is **not** listed here. This
 * plugin is what mounts it, so waiting for it at the top level deadlocks: the
 * fiber stays pending on a service only its own body can create, and the whole
 * plugin fails to activate. It is injected in a child scope after `$mount`
 * resolves instead — see `apply`.
 */
/** How long a query waits for the mounted capability before saying so. */
const REMOTE_READY_TIMEOUT_MS = 2000

/** Paths kept in the per-session name roll. Bounded: the roll is scanned on every render. */
const LEXICON_LIMIT = 500

/**
 * Turn a failed `@file` query into one line the reader can act on.
 *
 * The message is shown in a menu row, so it names the next step rather than the
 * exception. The Gateway reports an endpoint no active Remote exports as a
 * transport-level miss, which for this distribution means the Host half of the
 * workbench is not mounted in the running profile — a different repair from a
 * workspace that moved.
 * @param error - Whatever the query rejected with.
 * @returns The description shown under the notice.
 */
function describeQueryFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  if (text.includes('not found') || text.includes('invocation-unavailable')) {
    return 'The workbench Host is not answering in this profile. Reinstall the daily layer, then reopen the window.'
  }
  return `The workspace query failed: ${text}`
}

export const inject = ['slots', 'remote', 'inputTriggers']

/**
 * Register the workbench panels.
 *
 * The workbench takes one entry in the `conversation.view` ring, so it is a
 * view the user switches to alongside chat and trajectory. An earlier plan
 * named `conversation.details.tool`, which the official contract declares as a
 * **single** slot whose occupant renders every tool's output; taking it would
 * have replaced the tool details panel instead of adding a workbench beside it.
 * `OFFICIAL_SLOT_KINDS` records that, and a test rejects any panel placed in a
 * single-kind slot.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installWorkbenchStyles(document), 'workbench: stylesheet')

  // Mounted through the public `$mount`, so workbench calls travel the same
  // official gateway as every generated contribution. The descriptors are this
  // project's own because the generator cannot emit them for an out-of-tree
  // package; nothing here reads a private upstream path.
  ctx.effect(() => {
    // The official disposer may return a promise; this effect must return
    // synchronously, so the call is issued and its settlement ignored on
    // purpose rather than by omission.
    let disposer: (() => unknown) | undefined
    let withdrawn = false
    void ctx.remote.$mount(WORKBENCH_REMOTE).then(
      (dispose) => {
        // Disposal can win the race against mounting; withdrawing immediately
        // keeps a late mount from outliving the effect that asked for it.
        if (withdrawn) void dispose()
        else disposer = dispose
      },
      (error: unknown) => {
        console.error('[dsh-foundry] the workbench remote contribution failed to mount', error)
      },
    )
    return () => {
      withdrawn = true
      void disposer?.()
    }
  }, 'workbench: remote contribution')

  // The source is registered synchronously, before anything is awaited. The
  // per-session controller warms its source roster once when a session scope
  // comes alive, so a source that arrives after an awaited mount is missing
  // from every session that already existed — the menu simply never asks it for
  // candidates, with no error anywhere. The remote it needs is resolved at
  // query time through the promise below instead.
  // Per-session name rolls for reference decoration, filled by `warm`.
  const lexicons = new Map<string, readonly string[]>()
  const lexiconListeners = new Map<string, Set<() => void>>()

  let resolveRemote: (remote: WorkbenchRemote) => void
  const remoteReady = new Promise<WorkbenchRemote>((settle) => {
    resolveRemote = settle
  })

  // Registered in a child scope that injects the mounted namespace. Cordis
  // refuses a property read on a service the fiber did not inject, so reading
  // `ctx.remote.dshWorkbench` from the root scope fails at query time with
  // `cannot get property "remote.dshWorkbench" without inject` — the source
  // registers, the menu calls it, every query throws, and the only trace is a
  // console line. Injecting it here also delays registration until the
  // namespace exists, so the menu never sees a half-ready source.
  // The same resolution feeds the panels. They cannot read the namespace
  // themselves for the reason above, so the holder is the one publication point
  // and the `@` menu and the workbench tab can never disagree about whether the
  // Host is reachable.
  const remoteHolder = createRemoteHolder<WorkbenchRemoteFace>()

  ctx.inject([`remote.${WORKBENCH_SERVICE}`], (scope) => {
    const mounted = (scope.remote as unknown as Record<string, unknown>)[WORKBENCH_SERVICE]
    resolveRemote(mounted as WorkbenchRemote)
    remoteHolder.set(mounted as WorkbenchRemoteFace)
  })

  ctx.effect(() => ctx.inputTriggers.registerSource({
    trigger: REFERENCE_TRIGGER,
    name: REFERENCE_SOURCE_NAME,
    candidates: async (session, request) => {
      // Debounced against the request's own signal, so a superseded keystroke
      // never reaches the Host and a fast typist issues one query, not one per
      // character.
      await new Promise((settle) => setTimeout(settle, DEBOUNCE_MS))
      if (request.signal.aborted) return []
      // Raced against a deadline rather than awaited outright: if the mount
      // never settles, an unguarded await hangs the callback forever and the
      // menu renders nothing at all, with no error to explain the emptiness.
      const remote = await Promise.race([
        remoteReady,
        new Promise<null>((settle) => setTimeout(() => settle(null), REMOTE_READY_TIMEOUT_MS)),
      ])
      if (remote === null) {
        return [referenceNotice(
          'file references are still starting',
          'The workbench capability has not finished mounting. Try again in a moment.',
        )]
      }
      try {
        const candidates = await referenceCandidates(remote, session.sessionId, request.query)
        // Checked again after the await: the menu may have closed or the query
        // moved on while the Host was walking the workspace.
        return request.signal.aborted ? [] : candidates.slice(0, CANDIDATE_LIMIT + 1)
      } catch (error) {
        // Aborted is the one silent case: the menu closed or the query moved on,
        // and the official reducer drops a superseded generation anyway.
        if (request.signal.aborted) return []
        // Everything else is reported. Returning `[]` here renders identically
        // to having no reference source at all — the reducer closes a menu whose
        // groups are all ready-and-empty — so a Host that is unreachable, a
        // workspace that vanished, and a permission error would each present as
        // "`@` does nothing" with nothing in the console to contradict it.
        console.error('[dsh-foundry] the @file query failed', error)
        return [referenceNotice(
          'file references are unavailable',
          describeQueryFailure(error),
        )]
      }
    },
    // `@` is a reference trigger, and the contract states that implementing
    // `lexicon` **is** the participation claim for one: the render side scans
    // the draft for `<trigger><name>` tokens and decorates exact matches. A
    // source that never supplies a roll is not a participating reference
    // source, which is why a `/` command source needs neither hook and this one
    // does. `warm` fills the roll once per session scope; `lexicon` answers
    // synchronously from it and returns `undefined` until it is warm, because
    // the render path must not fetch.
    warm(session) {
      void (async () => {
        try {
          const remote = await Promise.race([
            remoteReady,
            new Promise<null>((settle) => setTimeout(() => settle(null), REMOTE_READY_TIMEOUT_MS)),
          ])
          if (remote === null) return
          const found = unwrapRemote(await remote.findPaths(session.sessionId, '', { maxResults: LEXICON_LIMIT }), 'findPaths')
          lexicons.set(session.sessionId, found.items.map((item) => item.path))
          for (const listener of lexiconListeners.get(session.sessionId) ?? []) listener()
        } catch (error) {
          // A workspace that vanished or a cancelled walk leaves the roll
          // unset, which reads as "not warm yet" rather than "no files". The
          // decoration scan degrades silently by design — a menu query reports
          // the same failure where the user can act on it — but the reason is
          // logged, because an unwarmed roll is otherwise indistinguishable
          // from an empty workspace.
          console.warn('[dsh-foundry] the @file name roll could not be warmed', error)
        }
      })()
    },
    lexicon(session) {
      return lexicons.get(session.sessionId)
    },
    subscribeLexicon(session, listener: () => void) {
      const listeners = lexiconListeners.get(session.sessionId) ?? new Set()
      listeners.add(listener)
      lexiconListeners.set(session.sessionId, listeners)
      return () => {
        listeners.delete(listener)
        if (listeners.size === 0) lexiconListeners.delete(session.sessionId)
      }
    },
    onPick(pick) {
      if (isTruncationNotice(pick.candidate.name)) return 'handled'
      return { insert: referenceInsert(pick.candidate.name) }
    },
    // Required because `onPick` returns an insert: the submit attempt
    // serializes each occurrence through it, and without one the attempt
    // rejects and the message cannot be sent at all.
    codec: referenceCodec,
  }), 'workbench: @file reference source')

  ctx.effect(() => ctx.slots.register(
    { name: WORKBENCH_SLOTS.panels, id: 'workbench', label: 'Workbench', registrant: 'dsh-workbench' },
    // Closed over rather than passed through the slot: the framework composes
    // the props it owns, and the Host face is this plugin's to supply.
    (props) => <WorkbenchView {...props} holder={remoteHolder} />,
  ), 'workbench: view tab')
}
