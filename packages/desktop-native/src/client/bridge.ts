/**
 * Renderer-side access to the Electron native bridge.
 *
 * The bridge is optional by construction: the same client plugin graph runs in
 * an ordinary browser, where `window.dshDesktop` is absent. Every consumer here
 * asks for the bridge and handles its absence rather than assuming a desktop
 * host, and a version mismatch is reported instead of being papered over.
 * @module @dsh-foundry/native/client/bridge
 */
import {
  DESKTOP_BRIDGE_KEY,
  isBridgeCompatible,
  type DesktopBridgeV1,
  type DesktopCapabilitiesV1,
  type DesktopOperation,
} from '@dsh-foundry/contract'

declare global {
  interface Window {
    /** Present only under the Electron companion shell. */
    [DESKTOP_BRIDGE_KEY]?: DesktopBridgeV1
  }
}

/**
 * The native bridge, when this document is running under the desktop shell.
 * @returns The bridge, or `undefined` in an ordinary browser.
 */
export function desktopBridge(): DesktopBridgeV1 | undefined {
  return typeof window === 'undefined' ? undefined : window[DESKTOP_BRIDGE_KEY]
}

/** Why the desktop-only surface is unavailable. */
export type BridgeStatus =
  | { readonly kind: 'absent' }
  | { readonly kind: 'incompatible', readonly detected: number, readonly required: number }
  | { readonly kind: 'ready', readonly capabilities: DesktopCapabilitiesV1, readonly bridge: DesktopBridgeV1 }

/**
 * Resolve the bridge and check it serves the operations the caller needs.
 *
 * A missing or incompatible bridge produces a reportable status, never a
 * nonfunctional control and never a fallback to a private browser API.
 * @param required - Operations the caller will invoke.
 * @returns The bridge status.
 */
export async function resolveBridge(required: readonly DesktopOperation[]): Promise<BridgeStatus> {
  const bridge = desktopBridge()
  if (bridge === undefined) return { kind: 'absent' }
  const capabilities = await bridge.describe()
  if (!isBridgeCompatible(capabilities, required)) {
    return { kind: 'incompatible', detected: capabilities.bridgeVersion, required: 1 }
  }
  return { kind: 'ready', capabilities, bridge }
}
