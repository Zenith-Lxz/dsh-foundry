/**
 * `DesktopBridgeV1` — the complete native-capability contract between the
 * desktop client plugins and the Electron main process.
 *
 * The operation set is closed by construction: {@link DESKTOP_OPERATIONS} is
 * the only dispatch table, there is no generic `invoke(channel, value)`, and no
 * filesystem, process, environment, shell, or Harness surface appears here.
 * Harness API, session, stream, tool, terminal, and download traffic never
 * crosses this bridge; it stays on the official DSH HTTP/WebSocket transport.
 *
 * Both directions are runtime-validated against this module: preload validates
 * before sending, main validates again before touching Electron or the
 * operating system. A renderer is never trusted for having passed the first.
 * @module @dsh-foundry/contract
 */

/** Bridge protocol version. A renderer requiring a different major refuses to present the desktop frame. */
export const DESKTOP_BRIDGE_VERSION = 1 as const

/** The property name the preload script exposes on `window`. */
export const DESKTOP_BRIDGE_KEY = 'dshDesktop' as const

/** The single Electron IPC channel; the operation lives in the validated envelope, never in the channel name. */
export const DESKTOP_IPC_CHANNEL = 'dsh-desktop:v1' as const

/** The channel main uses to push window-state snapshots to an authorized renderer. */
export const DESKTOP_WINDOW_STATE_CHANNEL = 'dsh-desktop:v1:window-state' as const

/** Qualification targets. The desktop product is built for these two only. */
export type DesktopPlatform = 'darwin' | 'win32'

/** The closed operation set. Adding a member requires a typed contract, validation, least-authority review, and negative tests. */
export const DESKTOP_OPERATIONS = [
  'describe',
  'pickDirectory',
  'performWindowAction',
  'openExternal',
  'getWindowState',
  'setWindowTitle',
] as const

/** One member of the closed operation set. */
export type DesktopOperation = (typeof DESKTOP_OPERATIONS)[number]

/** Window actions the frame may request. Closed: an unlisted action is rejected before Electron is invoked. */
export const WINDOW_ACTIONS = [
  'minimize',
  'toggle-maximize',
  'close',
  'toggle-fullscreen',
] as const

/** One requestable window action. */
export type WindowAction = (typeof WINDOW_ACTIONS)[number]

/** Maximum accepted byte length of any single string field, applied before the value reaches main. */
export const MAX_STRING_BYTES = 4096

/**
 * Maximum accepted window-title length, in code points.
 *
 * Far below {@link MAX_STRING_BYTES}: a title beyond this is not readable in
 * any operating-system chrome that displays it, and the surplus only burdens
 * the window menu and task switcher.
 */
export const MAX_TITLE_LENGTH = 256

/** Maximum accepted byte length of a whole request envelope. */
export const MAX_REQUEST_BYTES = 16384

/**
 * Immutable application and platform facts the desktop layout needs to choose
 * its chrome. Everything here is fixed for the life of the process; mutable
 * window state is {@link WindowStateV1} instead.
 */
export interface DesktopCapabilitiesV1 {
  readonly bridgeVersion: typeof DESKTOP_BRIDGE_VERSION
  readonly platform: DesktopPlatform
  readonly arch: string
  /** Companion application version, not the Harness version. */
  readonly appVersion: string
  /** Exact official `@deepseek-ai/dsh` version this instance supervises. */
  readonly dshVersion: string
  readonly electronVersion: string
  /** The operations this build actually serves; the client must not assume the full set. */
  readonly operations: readonly DesktopOperation[]
  /** Which caption treatment the frame must render. */
  readonly windowControls: 'macos-traffic-lights' | 'windows-caption'
  /** Native path separator, so the client formats paths without inferring from content. */
  readonly pathSeparator: '/' | '\\'
}

/** Mutable window state mirrored to the frame so its caption controls match the real window. */
export interface WindowStateV1 {
  readonly maximized: boolean
  readonly minimized: boolean
  readonly fullScreen: boolean
  readonly focused: boolean
}

/** Request a native directory chooser parented to the active window. */
export interface PickDirectoryRequestV1 {
  /** Caller-generated id, echoed on the result so a late answer cannot be applied to a newer request. */
  readonly requestId: string
  /** Dialog title; the operating-system default is used when absent. */
  readonly title?: string
}

/**
 * The single settlement of one directory request.
 *
 * `path` is an **opaque native absolute path**: a POSIX path on macOS, a
 * drive-qualified or UNC path on Windows. It is never normalized into the other
 * platform's syntax, coerced to a URI, truncated, or case-rewritten.
 */
export type PickDirectoryResultV1 =
  | { readonly outcome: 'picked'; readonly requestId: string; readonly path: string }
  | { readonly outcome: 'cancelled'; readonly requestId: string }

/** Request one window action against the window that owns the calling renderer. */
export interface WindowActionRequestV1 {
  readonly action: WindowAction
}

/** Set the owned window's operating-system title. */
export interface SetWindowTitleRequestV1 {
  /** Normalized and length-bounded before it reaches the window; see {@link parseSetWindowTitleRequest}. */
  readonly title: string
}

/** Request the operating system open an external URL outside the application window. */
export interface OpenExternalRequestV1 {
  /** Validated to `http:` or `https:` before the operating system sees it. */
  readonly url: string
}

/** Closed failure classification. Diagnostics name the class, never the payload. */
export const BRIDGE_FAILURE_CODES = [
  'invalid-request',
  'unknown-operation',
  'unauthorized',
  'unavailable',
  'window-gone',
  'superseded',
  'operating-system-error',
] as const

/** One failure class. */
export type BridgeFailureCode = (typeof BRIDGE_FAILURE_CODES)[number]

/**
 * A typed bridge failure. The message is a fixed, bounded description of the
 * failure class — it never carries selected paths, URLs with query data,
 * credentials, environment values, or Harness request bodies.
 */
export class DesktopBridgeError extends Error {
  readonly code: BridgeFailureCode
  readonly operation: string

  /**
   * @param code - The failure class.
   * @param operation - Requested operation name, as received.
   * @param detail - Bounded, non-sensitive clarification.
   */
  constructor(code: BridgeFailureCode, operation: string, detail?: string) {
    super(detail === undefined ? `${operation}: ${code}` : `${operation}: ${code} (${detail})`)
    this.name = 'DesktopBridgeError'
    this.code = code
    this.operation = operation
  }
}

/** The frozen object preload exposes. This is the entire native authority available to the renderer. */
export interface DesktopBridgeV1 {
  /** Immutable capability description; the client checks `bridgeVersion` before presenting native controls. */
  describe(): Promise<DesktopCapabilitiesV1>
  /** Open a native directory chooser and settle exactly once. */
  pickDirectory(request: PickDirectoryRequestV1): Promise<PickDirectoryResultV1>
  /** Perform one window action against the owning window. */
  performWindowAction(request: WindowActionRequestV1): Promise<void>
  /** Open a validated `http:`/`https:` URL through the operating system. */
  openExternal(request: OpenExternalRequestV1): Promise<void>
  /**
   * Set the owned window's operating-system title, so the window menu and task
   * switcher agree with the title the frame renders.
   *
   * Write-only and confined to the owned window: it reads nothing back and
   * reaches no other window, process, or document.
   */
  setWindowTitle(request: SetWindowTitleRequestV1): Promise<void>
  /** Current window state, for the frame's first paint. */
  getWindowState(): Promise<WindowStateV1>
  /**
   * Observe window state so caption controls track window changes the frame did
   * not initiate — the user dragging to maximize, a macOS full-screen
   * transition, an operating-system keyboard shortcut.
   *
   * Read-only and least-authority: booleans only, no geometry and no content.
   * @param listener - Called with each new state while subscribed.
   * @returns Unsubscribe; safe to call after teardown.
   */
  subscribeWindowState(listener: (state: WindowStateV1) => void): () => void
}

/** Envelope preload sends on {@link DESKTOP_IPC_CHANNEL}. */
export interface BridgeRequestEnvelope {
  readonly operation: string
  readonly payload: unknown
}

/**
 * Report whether a value is a plain object usable as a validated record.
 * @param value - Candidate.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Validate a string field: present, non-empty, and within the byte bound.
 * @param value - Candidate value.
 * @param field - Field name for the failure detail.
 * @param operation - Operation name for the failure.
 * @returns The validated string.
 * @throws DesktopBridgeError `invalid-request` when absent, empty, or oversized.
 */
function requireBoundedString(value: unknown, field: string, operation: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new DesktopBridgeError('invalid-request', operation, `${field} must be a non-empty string`)
  }
  if (Buffer.byteLength(value, 'utf8') > MAX_STRING_BYTES) {
    throw new DesktopBridgeError('invalid-request', operation, `${field} exceeds ${MAX_STRING_BYTES} bytes`)
  }
  return value
}

/**
 * Narrow an incoming operation name to the closed set.
 *
 * This is the only place an operation name becomes dispatchable, which is what
 * keeps the bridge free of dynamic dispatch.
 * @param value - Operation name as received.
 * @returns The narrowed operation.
 * @throws DesktopBridgeError `unknown-operation` for anything outside the set.
 */
export function requireOperation(value: unknown): DesktopOperation {
  if (typeof value !== 'string') throw new DesktopBridgeError('unknown-operation', 'unknown')
  const found = DESKTOP_OPERATIONS.find((operation) => operation === value)
  if (found === undefined) throw new DesktopBridgeError('unknown-operation', value)
  return found
}

/**
 * Validate a whole request envelope, including its total size.
 * @param value - Raw IPC argument.
 * @returns The validated envelope with a narrowed operation.
 * @throws DesktopBridgeError `invalid-request` or `unknown-operation`.
 */
export function parseRequestEnvelope(value: unknown): { operation: DesktopOperation, payload: unknown } {
  if (!isRecord(value)) throw new DesktopBridgeError('invalid-request', 'unknown', 'envelope must be an object')
  let encoded: string
  try {
    encoded = JSON.stringify(value) ?? ''
  } catch {
    // A cyclic or non-serializable payload cannot have crossed a structured-clone
    // boundary as declared; treat it as malformed rather than measuring it.
    throw new DesktopBridgeError('invalid-request', 'unknown', 'envelope is not serializable')
  }
  if (Buffer.byteLength(encoded, 'utf8') > MAX_REQUEST_BYTES) {
    throw new DesktopBridgeError('invalid-request', 'unknown', `envelope exceeds ${MAX_REQUEST_BYTES} bytes`)
  }
  return { operation: requireOperation(value['operation']), payload: value['payload'] }
}

/**
 * Validate a directory-selection request.
 * @param value - Raw payload.
 * @returns The validated request.
 * @throws DesktopBridgeError `invalid-request` when a field is absent, mistyped, or oversized.
 */
export function parsePickDirectoryRequest(value: unknown): PickDirectoryRequestV1 {
  if (!isRecord(value)) throw new DesktopBridgeError('invalid-request', 'pickDirectory', 'payload must be an object')
  const requestId = requireBoundedString(value['requestId'], 'requestId', 'pickDirectory')
  const rawTitle = value['title']
  if (rawTitle === undefined) return { requestId }
  return { requestId, title: requireBoundedString(rawTitle, 'title', 'pickDirectory') }
}

/**
 * Validate a window-action request against the closed action set.
 * @param value - Raw payload.
 * @returns The validated request.
 * @throws DesktopBridgeError `invalid-request` for a non-object or unlisted action.
 */
export function parseWindowActionRequest(value: unknown): WindowActionRequestV1 {
  if (!isRecord(value)) {
    throw new DesktopBridgeError('invalid-request', 'performWindowAction', 'payload must be an object')
  }
  const action = WINDOW_ACTIONS.find((candidate) => candidate === value['action'])
  if (action === undefined) {
    throw new DesktopBridgeError('invalid-request', 'performWindowAction', 'action is not a supported window action')
  }
  return { action }
}

/**
 * Characters removed from a window title before the operating system sees it.
 *
 * Two groups, for two different reasons:
 *
 * - **Control characters** (C0, DEL, C1) have no meaning in a title and can
 *   truncate or corrupt the string in native chrome that expects a plain line.
 * - **Bidirectional overrides and isolates** can reorder text *around* the
 *   title in the window menu and task switcher, which is a presentation-level
 *   spoofing vector rather than a rendering artifact.
 */
// eslint-disable-next-line no-control-regex -- matching control characters is the point: these are the codepoints a title must never carry.
const TITLE_FORBIDDEN = /[\u0000-\u001F\u007F-\u009F\u202A-\u202E\u2066-\u2069]/g

/**
 * Validate and normalize a window-title request.
 *
 * The title is **normalized rather than rejected** on formatting: it originates
 * from workspace and session names, where a stray newline or run of spaces is
 * ordinary, and the operation is cosmetic — refusing the whole title over a
 * formatting artifact would leave the operating system showing a stale one.
 * Length and forbidden characters are still hard limits.
 * @param value - Raw payload.
 * @returns The validated request with a single-line, bounded title.
 * @throws DesktopBridgeError `invalid-request` when the payload is not an
 * object, the title is not a string, or nothing survives normalization.
 */
export function parseSetWindowTitleRequest(value: unknown): SetWindowTitleRequestV1 {
  if (!isRecord(value)) throw new DesktopBridgeError('invalid-request', 'setWindowTitle', 'payload must be an object')
  const raw = value['title']
  if (typeof raw !== 'string') {
    throw new DesktopBridgeError('invalid-request', 'setWindowTitle', 'title must be a string')
  }
  const normalized = raw.replace(TITLE_FORBIDDEN, '').replace(/\s+/g, ' ').trim()
  if (normalized.length === 0) {
    throw new DesktopBridgeError('invalid-request', 'setWindowTitle', 'title is empty after normalization')
  }
  return { title: [...normalized].slice(0, MAX_TITLE_LENGTH).join('') }
}

/**
 * Validate an external-open request, including its scheme.
 *
 * Only `http:` and `https:` are accepted, so `file:`, `javascript:`, and custom
 * schemes cannot reach the operating-system opener.
 * @param value - Raw payload.
 * @returns The validated request.
 * @throws DesktopBridgeError `invalid-request` for a malformed URL or rejected scheme.
 */
export function parseOpenExternalRequest(value: unknown): OpenExternalRequestV1 {
  if (!isRecord(value)) throw new DesktopBridgeError('invalid-request', 'openExternal', 'payload must be an object')
  const url = requireBoundedString(value['url'], 'url', 'openExternal')
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    // URL construction is the validation; a rejected string never reaches the opener.
    throw new DesktopBridgeError('invalid-request', 'openExternal', 'url is not absolute')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new DesktopBridgeError('invalid-request', 'openExternal', 'scheme must be http or https')
  }
  return { url }
}

/**
 * Report whether a capability description satisfies this client's required
 * bridge version and operation set.
 * @param capabilities - Description returned by `describe()`.
 * @param required - Operations the caller will actually invoke.
 * @returns True when the version matches and every required operation is served.
 */
export function isBridgeCompatible(
  capabilities: DesktopCapabilitiesV1,
  required: readonly DesktopOperation[],
): boolean {
  if (capabilities.bridgeVersion !== DESKTOP_BRIDGE_VERSION) return false
  return required.every((operation) => capabilities.operations.includes(operation))
}
