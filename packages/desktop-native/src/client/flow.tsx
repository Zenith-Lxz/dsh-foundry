/**
 * The renderless directory-flow occupant.
 *
 * It fills the public workspace directory-flow slots and answers each rising
 * `open` edge with exactly one outcome, reported through the owner's own
 * `onPicked` / `onCancel` / `onError` callbacks. Official workspace UI keeps
 * its trigger, adoption, and error behavior; only the chooser changes.
 *
 * Arming is edge-triggered on a ref so re-renders — including the owner
 * keeping `open` true while it adopts the path (`busy`) — cannot launch a
 * second dialog. Settlement rides a ref so a late answer reaches the owner's
 * current handlers, and an unmounted instance discards its settlement entirely
 * rather than driving a replacement's error surface.
 * @module @dsh-foundry/native/client/flow
 */
import { useEffect, useRef } from 'react'
import type { ReactElement } from 'react'
// Type-only: the published owner contract of the two directory-flow slots.
import type { DirectoryFlowOwnerProps } from '@deepseek-ai/dsh-client-ui-workspace/client'

/** The injected face: one native directory selection. */
export interface DesktopFlowInjected {
  /**
   * Open the native chooser.
   * @returns The selected native absolute path, or `null` when the user cancelled.
   */
  pick: () => Promise<string | null>
}

/**
 * Renderless occupant driving the Electron native chooser.
 * @param props - Owner conversation plus the injected pick call.
 * @returns Nothing; the chooser is an operating-system window.
 */
export function DesktopDirectoryFlow(props: DirectoryFlowOwnerProps & DesktopFlowInjected): ReactElement | null {
  const { open, pick } = props
  const armed = useRef(false)
  const outcome = useRef(props)
  outcome.current = props
  const alive = useRef(true)

  useEffect(() => {
    // React's development StrictMode runs cleanup once before the real
    // lifetime; re-arming on setup keeps that replay from discarding outcomes.
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])

  useEffect(() => {
    if (!open) {
      armed.current = false
      return
    }
    if (armed.current) return
    armed.current = true
    pick().then(
      (path) => {
        if (!alive.current) return
        if (path === null) outcome.current.onCancel()
        else outcome.current.onPicked(path)
      },
      (reason: unknown) => {
        if (!alive.current) return
        outcome.current.onError(reason instanceof Error ? reason.message : String(reason))
      },
    )
  }, [open, pick])

  return null
}
