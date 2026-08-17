/**
 * The `@file` reference source.
 *
 * Registered through the official `ctx.inputTriggers.registerSource` seam, so
 * the official menu renders the candidates and owns arrow-key navigation,
 * Enter/Tab confirmation, Escape dismissal, mouse selection, and focus. A
 * private overlay would have to reimplement all of that and would drift from
 * the `/` sources beside it — and a file picker that only works with a mouse is
 * the failure mode this seam exists to prevent.
 *
 * A pick inserts a **path reference, not file contents**. The agent already has
 * authorized tools for reading; pasting a file eagerly spends context the user
 * did not choose to spend and bypasses the permission flow reading goes
 * through. Everything that reaches the model still travels the official
 * business path and lands in the session log.
 * @module @dsh-foundry/daily-workbench/client/reference-source
 */
import type { PathCandidate } from '../discovery.ts'

/** Trigger character this source answers. */
export const REFERENCE_TRIGGER = '@'

/** Menu group label. */
export const REFERENCE_SOURCE_NAME = 'files'

/** Candidates shown at once. The official menu scrolls; a longer roll does not help. */
export const CANDIDATE_LIMIT = 20

/** Milliseconds a keystroke waits before a query is issued. */
export const DEBOUNCE_MS = 90

/**
 * What a mounted Remote method resolves to.
 *
 * The official client Remote **never rejects and never returns the business
 * value directly**: a transport failure, a withdrawn mount, and a Host
 * exception all resolve as `{ok: false}`. Typing a method as returning its
 * payload therefore compiles while every call reads a field off the envelope —
 * which is how `@file` came to fail with `Cannot read properties of undefined
 * (reading 'map')` at runtime with nothing to catch it earlier.
 */
export type RemoteAnswer<T> =
  | { readonly ok: true, readonly value: T }
  | { readonly ok: false, readonly error: { readonly code?: string, readonly message?: string } }

/** A bounded traversal answer. */
export interface BoundedPaths {
  readonly items: readonly PathCandidate[]
  readonly truncatedBy?: string
}

/** How the workbench Host is reached from the client. */
export interface WorkbenchRemote {
  /**
   * Find workspace paths matching a query.
   * @param session - Session whose workspace the Host confines the answer to.
   * @param query - Fuzzy path query.
   * @param limits - Result and time bounds.
   * @returns The envelope carrying ranked candidates and any truncation.
   */
  findPaths(
    session: string,
    query: string,
    limits?: { readonly maxResults?: number },
  ): Promise<RemoteAnswer<BoundedPaths>>
}

/**
 * Unwrap a Remote answer, turning a failed call into a throw.
 *
 * Callers here want one failure path, and the envelope's `ok: false` carries
 * exactly the diagnosis a notice should show. Returning a default instead would
 * reintroduce the silent emptiness this module exists to avoid.
 * @param answer - What the Remote method resolved to.
 * @param endpoint - Method name, for the message.
 * @returns The business value.
 * @throws When the call did not succeed.
 */
export function unwrapRemote<T>(answer: RemoteAnswer<T>, endpoint: string): T {
  if (answer.ok) return answer.value
  const code = answer.error.code === undefined ? '' : `${answer.error.code}: `
  throw new Error(`${endpoint} failed — ${code}${answer.error.message ?? 'no reason reported'}`)
}

/** One candidate as the official menu consumes it. */
export interface ReferenceCandidate {
  readonly name: string
  readonly description?: string
  readonly hint?: string
}

/**
 * Choose the label for a path, disambiguating repeated basenames.
 *
 * A menu showing three rows that all read `index.ts` cannot be chosen from.
 * Each ambiguous row grows leftwards by one directory until the labels differ,
 * so the shortest distinguishing form is what the reader sees.
 * @param paths - Workspace-relative paths, in display order.
 * @returns A label per path, index-aligned with the input.
 */
export function disambiguate(paths: readonly string[]): string[] {
  const segments = paths.map((path) => path.split('/'))
  const depth = segments.map(() => 1)
  const labelAt = (index: number): string => segments[index]!.slice(-depth[index]!).join('/')
  // Bounded rather than unbounded: two paths that differ only above the deepest
  // shared directory would otherwise grow until they were both full paths, and
  // a menu of full paths is no more readable than a menu of basenames.
  for (let pass = 0; pass < 8; pass += 1) {
    const counts = new Map<string, number>()
    for (let index = 0; index < segments.length; index += 1) {
      const label = labelAt(index)
      counts.set(label, (counts.get(label) ?? 0) + 1)
    }
    let grew = false
    for (let index = 0; index < segments.length; index += 1) {
      if ((counts.get(labelAt(index)) ?? 0) > 1 && depth[index]! < segments[index]!.length) {
        depth[index] = depth[index]! + 1
        grew = true
      }
    }
    if (!grew) break
  }
  return segments.map((_parts, index) => labelAt(index))
}

/**
 * Build menu candidates for one query.
 *
 * Directories keep a trailing slash so a reader can tell at a glance what a
 * reference points at. Truncation is surfaced as a trailing non-selectable row
 * rather than dropped: a developer who cannot see that the list stopped early
 * reads a missing file as absent.
 * @param remote - The workbench Host face.
 * @param session - Session whose workspace the query is confined to.
 * @param query - Text typed after the trigger.
 * @returns Candidates for the official menu.
 */
export async function referenceCandidates(
  remote: WorkbenchRemote,
  session: string,
  query: string,
): Promise<readonly ReferenceCandidate[]> {
  const found = unwrapRemote(
    await remote.findPaths(session, query, { maxResults: CANDIDATE_LIMIT }),
    'findPaths',
  )
  const labels = disambiguate(found.items.map((item) => item.path))
  const candidates: ReferenceCandidate[] = found.items.map((item, index) => ({
    name: item.path,
    description: labels[index]! + (item.kind === 'directory' ? '/' : ''),
    ...(labels[index] === item.path ? {} : { hint: item.path }),
  }))
  if (found.truncatedBy !== undefined) {
    candidates.push(referenceNotice(
      `more matches (stopped: ${found.truncatedBy})`,
      'Type more characters to narrow the search.',
    ))
  }
  return candidates
}

/**
 * Prefix every non-selectable notice carries.
 *
 * `InputTriggerCandidate` is closed display data with no behavior flag, so a
 * source recognizes its own notices by name and nothing else can. The mark is a
 * character no workspace-relative path produced by {@link WorkspaceScope} can
 * start with, which is what keeps a real file from being treated as a notice.
 */
const NOTICE_MARK = '…'

/**
 * Build a non-selectable menu notice.
 *
 * A notice exists because an **empty roll is invisible**: the official reducer
 * closes a menu whose every group is ready-and-empty, so returning `[]` for a
 * failure renders exactly the same as typing `@` into a build with no reference
 * source at all. That is the state a user reports as "`@` does nothing".
 * @param headline - What happened, in the menu's first line.
 * @param detail - What the reader can do about it.
 * @returns A candidate that renders and refuses to insert.
 */
export function referenceNotice(headline: string, detail: string): ReferenceCandidate {
  return { name: `${NOTICE_MARK}${headline}`, description: detail }
}

/**
 * Whether a candidate is a non-selectable notice.
 * @param name - Candidate name.
 * @returns True when picking it should do nothing.
 */
export function isTruncationNotice(name: string): boolean {
  return name.startsWith(NOTICE_MARK)
}

/**
 * The model and clipboard projections of one file reference.
 *
 * **A source producing insert outcomes must supply this.** The submit attempt
 * serializes every occurrence through the owning source's codec, and a source
 * without one makes the attempt reject with
 * `slash: no serializer for reference source "files"` — the draft accepts the
 * chip and the message can then never be sent. The official contract says
 * failure here blocks the send rather than silently downgrading to the
 * clipboard text, so the absence is not recoverable at send time.
 *
 * The model form is `@<path>`, matching the official `@subagent` source: `@`
 * references ship to the model as the literal text the user sees. It stays a
 * **path**, never file contents — the agent reads through its own authorized
 * tools, and pasting a file here would spend context the user did not choose to
 * spend and bypass the permission flow reading goes through.
 */
export const referenceCodec = {
  /**
   * Clipboard and persistence projection.
   * @param ref - Workspace-relative path.
   * @returns The text a copy or a reload restores.
   */
  clipboardText: (ref: string): string => `${REFERENCE_TRIGGER}${ref}`,
  /**
   * Model projection, resolved per occurrence by the submit attempt.
   * @param ref - Workspace-relative path.
   * @returns The text the model receives in place of the chip.
   */
  serialize: (ref: string): Promise<string> => Promise.resolve(`${REFERENCE_TRIGGER}${ref}`),
}

/**
 * Build the insert for a picked path.
 * @param path - Workspace-relative path.
 * @returns The reference insert the official pipeline applies.
 */
export function referenceInsert(path: string): {
  readonly source: string
  readonly ref: string
  readonly label: string
  readonly clipboardText: string
} {
  return {
    source: REFERENCE_SOURCE_NAME,
    ref: path,
    label: path.split('/').at(-1) ?? path,
    // Built through the codec so the chip, the clipboard, and the model form
    // cannot drift from one another.
    clipboardText: referenceCodec.clipboardText(path),
  }
}
