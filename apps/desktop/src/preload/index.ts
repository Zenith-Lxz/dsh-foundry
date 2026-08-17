/**
 * The preload bridge: one frozen object, and nothing else.
 *
 * What is deliberately absent is the contract. There is no `ipcRenderer`, no
 * generic `invoke(channel, value)`, no `require`, no filesystem primitive, no
 * `process`/`env` access, and no unrestricted Electron API. A compromised
 * renderer — official client code included — reaches exactly the operations
 * enumerated in {@link DESKTOP_OPERATIONS} and nothing beyond them.
 *
 * Validation here is a fast reject for the caller's benefit, not a security
 * boundary: main re-validates every request. A renderer is never trusted for
 * having passed this side.
 * @module @dsh-foundry/app/preload
 */
import { contextBridge, ipcRenderer } from 'electron'
import {
  DESKTOP_BRIDGE_KEY,
  DESKTOP_IPC_CHANNEL,
  DESKTOP_WINDOW_STATE_CHANNEL,
  parseOpenExternalRequest,
  parsePickDirectoryRequest,
  parseSetWindowTitleRequest,
  parseWindowActionRequest,
  type DesktopBridgeV1,
  type DesktopCapabilitiesV1,
  type OpenExternalRequestV1,
  type PickDirectoryRequestV1,
  type PickDirectoryResultV1,
  type SetWindowTitleRequestV1,
  type WindowActionRequestV1,
  type WindowStateV1,
} from '@dsh-foundry/contract'

/**
 * Send one validated operation to main.
 * @param operation - Operation name from the closed set.
 * @param payload - Already-validated payload.
 * @returns The operation's result.
 */
async function send<T>(operation: string, payload: unknown): Promise<T> {
  return ipcRenderer.invoke(DESKTOP_IPC_CHANNEL, { operation, payload }) as Promise<T>
}

const listeners = new Set<(state: WindowStateV1) => void>()

ipcRenderer.on(DESKTOP_WINDOW_STATE_CHANNEL, (_event, state: WindowStateV1) => {
  for (const listener of listeners) {
    try {
      listener(state)
    } catch {
      // A throwing subscriber must not stop the others from receiving the
      // snapshot, and there is no other consumer of its failure here.
    }
  }
})

const bridge: DesktopBridgeV1 = {
  async describe(): Promise<DesktopCapabilitiesV1> {
    return send<DesktopCapabilitiesV1>('describe', undefined)
  },
  async pickDirectory(request: PickDirectoryRequestV1): Promise<PickDirectoryResultV1> {
    return send<PickDirectoryResultV1>('pickDirectory', parsePickDirectoryRequest(request))
  },
  async performWindowAction(request: WindowActionRequestV1): Promise<void> {
    await send<void>('performWindowAction', parseWindowActionRequest(request))
  },
  async openExternal(request: OpenExternalRequestV1): Promise<void> {
    await send<void>('openExternal', parseOpenExternalRequest(request))
  },
  async setWindowTitle(request: SetWindowTitleRequestV1): Promise<void> {
    await send<void>('setWindowTitle', parseSetWindowTitleRequest(request))
  },
  async getWindowState(): Promise<WindowStateV1> {
    return send<WindowStateV1>('getWindowState', undefined)
  },
  subscribeWindowState(listener: (state: WindowStateV1) => void): () => void {
    listeners.add(listener)
    return () => {
      listeners.delete(listener)
    }
  },
}

contextBridge.exposeInMainWorld(DESKTOP_BRIDGE_KEY, Object.freeze(bridge))
