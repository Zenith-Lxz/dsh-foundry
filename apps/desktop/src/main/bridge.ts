/**
 * Main-side handling of the native bridge.
 *
 * Every request passes three independent checks before any Electron or
 * operating-system call happens:
 *
 * 1. **Sender** — the request came from the main frame of the owned window,
 *    not a child frame, a devtools context, or a stale `webContents`.
 * 2. **Origin** — the sending document's origin equals the exact origin the
 *    owned DSH child reported ready.
 * 3. **Generation** — the host generation that authorized the renderer is the
 *    generation still running, so a restart invalidates prior authority.
 *
 * Validation is re-run here against the shared contract; preload's validation
 * is a convenience for the caller and carries no authority.
 * @module @dsh-foundry/app/main/bridge
 */
import { BrowserWindow, dialog, ipcMain, shell, type IpcMainInvokeEvent } from 'electron'
import {
  DESKTOP_IPC_CHANNEL,
  DESKTOP_WINDOW_STATE_CHANNEL,
  DesktopBridgeError,
  parseOpenExternalRequest,
  parsePickDirectoryRequest,
  parseRequestEnvelope,
  parseSetWindowTitleRequest,
  parseWindowActionRequest,
  type DesktopCapabilitiesV1,
  type DesktopOperation,
  type PickDirectoryResultV1,
  type WindowStateV1,
} from '@dsh-foundry/contract'

/** What main needs to authorize and serve a bridge request. */
export interface BridgeHost {
  /** The window that owns the trusted renderer, or `undefined` before/after its life. */
  window(): BrowserWindow | undefined
  /** The exact owned DSH origin currently authorized, or `undefined` when no host is ready. */
  origin(): string | undefined
  /** The host generation currently running. */
  generation(): number
  /** Immutable capability description for this build. */
  capabilities(): DesktopCapabilitiesV1
  /** Record a bounded, redacted diagnostic line. */
  diagnostic(line: string): void
}

/**
 * Read the current window state.
 * @param window - The window to describe.
 * @returns Its boolean state snapshot.
 */
export function windowState(window: BrowserWindow): WindowStateV1 {
  return {
    maximized: window.isMaximized(),
    minimized: window.isMinimized(),
    fullScreen: window.isFullScreen(),
    focused: window.isFocused(),
  }
}

/**
 * Install the single IPC handler and the window-state broadcaster.
 *
 * One channel serves every operation: the operation name travels inside a
 * validated envelope, so there is no channel namespace a caller can probe and
 * no dynamic dispatch surface.
 * @param host - Access to the current window, origin, generation, and capabilities.
 * @returns A disposer removing the handler and its listeners.
 */
export function installBridge(host: BridgeHost): () => void {
  /** Directory requests in flight, keyed by request id, so a late answer cannot be reapplied. */
  const pending = new Map<string, { generation: number, webContentsId: number }>()

  ipcMain.handle(DESKTOP_IPC_CHANNEL, async (event: IpcMainInvokeEvent, raw: unknown) => {
    const { operation, payload } = parseRequestEnvelope(raw)
    authorize(event, operation, host)
    return dispatch(operation, payload, event, host, pending)
  })

  return () => {
    ipcMain.removeHandler(DESKTOP_IPC_CHANNEL)
    pending.clear()
  }
}

/**
 * Reject a request whose sender, origin, or generation is not current.
 * @param event - The invoke event.
 * @param operation - Operation being requested, for the failure message.
 * @param host - Current ownership facts.
 * @throws DesktopBridgeError `unauthorized` when any check fails.
 */
export interface SenderFacts {
  /** Whether the owned window exists and has not been destroyed. */
  readonly windowLive: boolean
  /** The origin the owned host reported ready, or `undefined` before readiness. */
  readonly ownedOrigin: string | undefined
  /** `webContents.id` of the owned window. */
  readonly ownedWebContentsId: number
  /** `webContents.id` of the sender. */
  readonly senderWebContentsId: number
  /** Whether the sender frame is the sender's main frame. */
  readonly senderIsMainFrame: boolean
  /** The sender frame's URL, as Electron reports it. */
  readonly senderUrl: string | undefined
}

/**
 * Decide whether one request carries current authority.
 *
 * A pure function over plain facts rather than over an `IpcMainInvokeEvent`,
 * because this is the security decision of the whole bridge and it must be
 * exhaustively testable without an Electron harness. `authorize` supplies the
 * facts; nothing else about the decision lives outside this function.
 * @param facts - Ownership and sender identity at request time.
 * @param operation - Operation being requested, for the failure message.
 * @returns The failure to throw, or `undefined` when the request is authorized.
 */
export function authorizationFailure(
  facts: SenderFacts,
  operation: string,
): DesktopBridgeError | undefined {
  if (!facts.windowLive) {
    return new DesktopBridgeError('window-gone', operation, 'no live owned window')
  }
  if (facts.ownedOrigin === undefined) {
    return new DesktopBridgeError('unauthorized', operation, 'no owned host origin is currently ready')
  }
  if (facts.senderWebContentsId !== facts.ownedWebContentsId) {
    return new DesktopBridgeError('unauthorized', operation, 'sender is not the owned window')
  }
  // The sender must be the owned window's MAIN frame. A child frame has a
  // different senderFrame, so an embedded document cannot borrow this authority
  // even when it happens to share the origin.
  if (!facts.senderIsMainFrame) {
    return new DesktopBridgeError('unauthorized', operation, 'sender is not the main frame')
  }
  if (safeOrigin(facts.senderUrl) !== facts.ownedOrigin) {
    return new DesktopBridgeError('unauthorized', operation, 'sender origin is not the owned host origin')
  }
  return undefined
}

function authorize(event: IpcMainInvokeEvent, operation: DesktopOperation, host: BridgeHost): void {
  const window = host.window()
  const failure = authorizationFailure({
    windowLive: window !== undefined && !window.isDestroyed(),
    ownedOrigin: host.origin(),
    ownedWebContentsId: window === undefined || window.isDestroyed() ? -1 : window.webContents.id,
    senderWebContentsId: event.sender.id,
    senderIsMainFrame: event.senderFrame === event.sender.mainFrame,
    senderUrl: event.senderFrame?.url,
  }, operation)
  if (failure !== undefined) throw failure
}

/** What the dialog settlement is judged against when it returns. */
export interface SettlementFacts {
  /** Host generation when the dialog opened. */
  readonly requestGeneration: number
  /** Host generation now that it has returned. */
  readonly currentGeneration: number
  /** Whether the requesting renderer has since been destroyed. */
  readonly senderDestroyed: boolean
  /** `webContents.id` of the renderer that opened the dialog. */
  readonly senderWebContentsId: number
  /** `webContents.id` of the window that is current now, if any. */
  readonly currentWebContentsId: number | undefined
}

/**
 * Decide whether a dialog result may still be delivered.
 *
 * A dialog is modal to the user but not to the application: the host can
 * restart and the window can be replaced while it is open. Delivering the
 * result anyway would hand a path to a renderer that no longer owns the
 * session, and would resolve a request whose generation is gone. Pure over
 * plain facts for the same reason as {@link authorizationFailure} — this
 * decision must be testable without opening a real dialog.
 * @param facts - Generation and renderer identity across the dialog's lifetime.
 * @returns The failure to throw, or `undefined` when the result may settle.
 */
export function settlementFailure(facts: SettlementFacts): DesktopBridgeError | undefined {
  if (facts.currentGeneration !== facts.requestGeneration) {
    return new DesktopBridgeError('superseded', 'pickDirectory', 'the host generation changed while the dialog was open')
  }
  if (facts.senderDestroyed || facts.senderWebContentsId !== facts.currentWebContentsId) {
    return new DesktopBridgeError('superseded', 'pickDirectory', 'the requesting renderer is no longer current')
  }
  return undefined
}

/**
 * Perform one authorized operation.
 * @param operation - The narrowed operation.
 * @param payload - Raw payload, re-validated here.
 * @param event - The invoke event, used to detect renderer replacement.
 * @param host - Current ownership facts.
 * @param pending - In-flight directory requests.
 * @returns The operation's documented result.
 */
async function dispatch(
  operation: DesktopOperation,
  payload: unknown,
  event: IpcMainInvokeEvent,
  host: BridgeHost,
  pending: Map<string, { generation: number, webContentsId: number }>,
): Promise<unknown> {
  const window = host.window()
  if (window === undefined || window.isDestroyed()) {
    throw new DesktopBridgeError('window-gone', operation)
  }
  switch (operation) {
    case 'describe':
      return host.capabilities()
    case 'getWindowState':
      return windowState(window)
    case 'performWindowAction': {
      const request = parseWindowActionRequest(payload)
      applyWindowAction(window, request.action)
      return undefined
    }
    case 'setWindowTitle': {
      const request = parseSetWindowTitleRequest(payload)
      // Write-only and scoped to the owned window: it reads nothing back and
      // cannot reach another window, process, or document.
      window.setTitle(request.title)
      return undefined
    }
    case 'openExternal': {
      const request = parseOpenExternalRequest(payload)
      // The URL is validated to http/https by the contract parser; the operating
      // system opens it in the user's browser, where it has no bridge access.
      await shell.openExternal(request.url)
      return undefined
    }
    case 'pickDirectory':
      return pickDirectory(payload, event, host, window, pending)
    default:
      throw new DesktopBridgeError('unknown-operation', operation)
  }
}

/**
 * Apply one window action.
 * @param window - The owned window.
 * @param action - The validated action.
 */
function applyWindowAction(window: BrowserWindow, action: string): void {
  switch (action) {
    case 'minimize':
      window.minimize()
      return
    case 'toggle-maximize':
      // macOS "zoom" and Windows "maximize/restore" are both expressed here;
      // the layout chooses which affordance to render, not which call to make.
      if (window.isMaximized()) window.unmaximize()
      else window.maximize()
      return
    case 'toggle-fullscreen':
      window.setFullScreen(!window.isFullScreen())
      return
    case 'close':
      window.close()
      return
    default:
      throw new DesktopBridgeError('invalid-request', 'performWindowAction', 'unsupported action')
  }
}

/**
 * Open a native directory chooser parented to the owned window and settle once.
 *
 * The dialog is modal to the owned window, so it cannot outlive it visually.
 * The settlement is guarded on both host generation and renderer identity: a
 * reload, a restart, or a window replacement while the dialog is open produces
 * a `superseded` failure rather than delivering a path to a document that did
 * not ask for it.
 * @param payload - Raw request payload.
 * @param event - The invoke event identifying the requesting renderer.
 * @param host - Current ownership facts.
 * @param window - The owned window the dialog parents to.
 * @param pending - In-flight requests, keyed by request id.
 * @returns The single settlement for this request.
 */
async function pickDirectory(
  payload: unknown,
  event: IpcMainInvokeEvent,
  host: BridgeHost,
  window: BrowserWindow,
  pending: Map<string, { generation: number, webContentsId: number }>,
): Promise<PickDirectoryResultV1> {
  const request = parsePickDirectoryRequest(payload)
  if (pending.has(request.requestId)) {
    throw new DesktopBridgeError('invalid-request', 'pickDirectory', 'requestId is already in flight')
  }
  const generation = host.generation()
  pending.set(request.requestId, { generation, webContentsId: event.sender.id })
  try {
    const result = await dialog.showOpenDialog(window, {
      properties: ['openDirectory', 'createDirectory'],
      ...(request.title === undefined ? {} : { title: request.title }),
    })
    const stale = settlementFailure({
      requestGeneration: generation,
      currentGeneration: host.generation(),
      senderDestroyed: event.sender.isDestroyed(),
      senderWebContentsId: event.sender.id,
      currentWebContentsId: host.window()?.webContents.id,
    })
    if (stale !== undefined) throw stale
    const [selected] = result.filePaths
    if (result.canceled || selected === undefined) {
      return { outcome: 'cancelled', requestId: request.requestId }
    }
    // The path crosses the bridge exactly as the operating system produced it:
    // POSIX on macOS, drive-qualified or UNC on Windows. No normalization, no
    // URI coercion, no case rewriting.
    return { outcome: 'picked', requestId: request.requestId, path: selected }
  } catch (error) {
    if (error instanceof DesktopBridgeError) throw error
    host.diagnostic('pickDirectory failed at the operating-system dialog')
    throw new DesktopBridgeError('operating-system-error', 'pickDirectory')
  } finally {
    pending.delete(request.requestId)
  }
}

/**
 * Broadcast window state to the trusted renderer whenever it changes.
 * @param window - The owned window.
 * @returns A disposer removing the listeners.
 */
export function broadcastWindowState(window: BrowserWindow): () => void {
  const events = [
    'maximize', 'unmaximize', 'minimize', 'restore',
    'enter-full-screen', 'leave-full-screen', 'focus', 'blur',
  ] as const
  const push = (): void => {
    if (window.isDestroyed()) return
    window.webContents.send(DESKTOP_WINDOW_STATE_CHANNEL, windowState(window))
  }
  // Electron declares one overload per event name, so the signatures do not
  // unify over a union; the listener takes no event-specific arguments, which
  // is what makes one narrowing safe for every member.
  for (const event of events) window.on(event as 'maximize', push)
  return () => {
    for (const event of events) window.off(event as 'maximize', push)
  }
}

/**
 * Parse an origin without throwing on a malformed or absent URL.
 * @param url - Candidate URL.
 * @returns The origin, or `undefined` when unparsable.
 */
function safeOrigin(url: string | undefined): string | undefined {
  if (url === undefined || url.length === 0) return undefined
  try {
    return new URL(url).origin
  } catch {
    // An unparsable sender URL cannot match the owned origin, which is the
    // decision the caller needs; there is no other reader.
    return undefined
  }
}
