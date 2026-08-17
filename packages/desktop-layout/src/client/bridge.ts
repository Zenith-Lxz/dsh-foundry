/**
 * Renderer-side access to the native bridge, and the React binding for live
 * window state.
 *
 * The desktop frame requires the bridge: it renders native window controls and
 * a platform-specific safe area, and both are wrong without real capabilities.
 * A missing or incompatible bridge therefore produces a reported status rather
 * than a frame with controls that do nothing.
 * @module @dsh-foundry/layout/client/bridge
 */
import { useEffect, useState } from 'react'
import {
  DESKTOP_BRIDGE_KEY,
  DESKTOP_BRIDGE_VERSION,
  isBridgeCompatible,
  type DesktopBridgeV1,
  type DesktopCapabilitiesV1,
  type DesktopOperation,
  type WindowStateV1,
} from '@dsh-foundry/contract'

declare global {
  interface Window {
    /** Present only under the Electron companion shell. */
    [DESKTOP_BRIDGE_KEY]?: DesktopBridgeV1
  }
}

/** The operations the desktop frame itself invokes. */
export const REQUIRED_OPERATIONS: readonly DesktopOperation[] = [
  'describe',
  'performWindowAction',
  'getWindowState',
]

/** Whether the desktop frame can present itself, and why not when it cannot. */
export type FrameStatus =
  | { readonly kind: 'pending' }
  | { readonly kind: 'absent' }
  | { readonly kind: 'incompatible', readonly detected: number, readonly required: number }
  | { readonly kind: 'ready', readonly bridge: DesktopBridgeV1, readonly capabilities: DesktopCapabilitiesV1 }

/**
 * The native bridge, when this document runs under the desktop shell.
 * @returns The bridge, or `undefined` in an ordinary browser.
 */
export function desktopBridge(): DesktopBridgeV1 | undefined {
  return typeof window === 'undefined' ? undefined : window[DESKTOP_BRIDGE_KEY]
}

/**
 * Resolve bridge capabilities once for the frame's lifetime.
 *
 * Capabilities are immutable for the life of the process, so this settles once
 * and does not poll. A resolution that lands after unmount is discarded rather
 * than setting state on a dead component.
 * @returns The current frame status.
 */
export function useFrameStatus(): FrameStatus {
  const [status, setStatus] = useState<FrameStatus>({ kind: 'pending' })
  useEffect(() => {
    const bridge = desktopBridge()
    if (bridge === undefined) {
      setStatus({ kind: 'absent' })
      return
    }
    let alive = true
    bridge.describe().then(
      (capabilities) => {
        if (!alive) return
        setStatus(
          isBridgeCompatible(capabilities, REQUIRED_OPERATIONS)
            ? { kind: 'ready', bridge, capabilities }
            : { kind: 'incompatible', detected: capabilities.bridgeVersion, required: DESKTOP_BRIDGE_VERSION },
        )
      },
      () => {
        if (!alive) return
        // A bridge that fails to describe itself is unusable in the same way an
        // absent one is, and the surface says so rather than guessing a version.
        setStatus({ kind: 'absent' })
      },
    )
    return () => {
      alive = false
    }
  }, [])
  return status
}

/**
 * Track live window state.
 *
 * Subscribing rather than polling is what lets the caption controls follow
 * changes the frame did not initiate — a drag to the screen edge, a macOS
 * full-screen transition, an operating-system keyboard shortcut.
 * @param bridge - The resolved bridge, or `undefined` before it resolves.
 * @returns The latest window state.
 */
export function useWindowState(bridge: DesktopBridgeV1 | undefined): WindowStateV1 {
  const [state, setState] = useState<WindowStateV1>({
    maximized: false,
    minimized: false,
    fullScreen: false,
    focused: true,
  })
  useEffect(() => {
    if (bridge === undefined) return
    let alive = true
    bridge.getWindowState().then(
      (initial) => {
        if (alive) setState(initial)
      },
      () => {
        // The subscription below still delivers the next change; the initial
        // read failing only means the first paint uses the default.
      },
    )
    const unsubscribe = bridge.subscribeWindowState((next) => {
      if (alive) setState(next)
    })
    return () => {
      alive = false
      unsubscribe()
    }
  }, [bridge])
  return state
}
