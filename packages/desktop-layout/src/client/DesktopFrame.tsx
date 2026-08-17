/**
 * The desktop root frame.
 *
 * Registered into the runtime's built-in `root` slot, it owns the title bar,
 * the three column tracks, the drag handles, the concession solve, and the
 * child-slot render decisions. The official sidebar, conversation, details, and
 * overlay occupants render inside it unchanged — this package composes them,
 * it does not reimplement or inspect them.
 *
 * Pure component: everything arrives through the framework shares
 * (`useStore`, `useSessions`, `actions`, `renderSlot`) plus the native bridge.
 * There are no Cordis imports and no self-made data hooks.
 * @module @dsh-foundry/layout/client/DesktopFrame
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { PropsRenderSlots, PropsRuntime, PropsStore } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopBridgeV1 } from '@dsh-foundry/contract'
import { computeColumns, SIDEBAR_AUTO_COLLAPSE, SIDEBAR_DEFAULT, TITLE_BAR_HEIGHT } from './columns.ts'
import type { createLayoutStore } from './store.ts'
import { useFrameStatus, useWindowState } from './bridge.ts'
import { TitleBar } from './TitleBar.tsx'
import { CompatibilitySurface } from './CompatibilitySurface.tsx'
import { composeWindowTitle } from './title.ts'

/** Shown only when there is no workspace or session context to title the window with. */
const APPLICATION_NAME = 'DeepSeek Harness'

/** Full composed props: runtime share, child-slot render share, and store share. */
export type DesktopFrameProps =
  & PropsRuntime<'root'>
  & PropsRenderSlots<'sidebar' | 'conversation' | 'details' | 'shell.overlay'>
  & PropsStore<ReturnType<typeof createLayoutStore>>

/** The desktop three-column frame under a platform title bar. */
export function DesktopFrame({
  useStore,
  useSessions,
  useWorkspaces,
  actions,
  renderSlot,
}: DesktopFrameProps): ReactElement {
  const panels = useStore((state) => state)
  const detailsSession = useSessions((sessions) => {
    const current = sessions.current
    return current !== undefined && sessions.byId[current]?.blank === false ? current : undefined
  })

  // Each selector returns a string so the hooks compare by value: selecting the
  // session or workspace object would re-render the whole frame on every
  // unrelated field change in those stores.
  const currentSessionId = useSessions((sessions) => sessions.current)
  const sessionTitle = useSessions((sessions) => {
    const current = sessions.current
    if (current === undefined) return undefined
    const summary = sessions.byId[current]
    // A blank session has no content to name the window after, and its display
    // title is only a placeholder the sidebar renders in its own words.
    return summary === undefined || summary.blank ? undefined : summary.displayTitle
  })
  const workspaceTitle = useWorkspaces((workspaces) => (
    currentSessionId === undefined
      ? undefined
      : workspaces.items.find((item) => item.sessionIds.includes(currentSessionId))?.title
  ))
  const title = composeWindowTitle(workspaceTitle, sessionTitle, APPLICATION_NAME)
  const status = useFrameStatus()
  const bridge: DesktopBridgeV1 | undefined = status.kind === 'ready' ? status.bridge : undefined
  const windowState = useWindowState(bridge)

  const frameRef = useRef<HTMLDivElement | null>(null)
  const [viewport, setViewport] = useState(() => window.innerWidth)

  // Switching to a different session closes details before paint, so a panel
  // opened for one session does not carry into the next.
  const lastSession = useRef(detailsSession)
  useLayoutEffect(() => {
    if (detailsSession === undefined) return
    if (lastSession.current !== undefined && lastSession.current !== detailsSession) actions.closeDetails()
    lastSession.current = detailsSession
  }, [actions, detailsSession])

  // Measure the frame's own box rather than the window: the frame is what the
  // columns divide, and a rAF-throttled observer keeps a resize drag cheap.
  useEffect(() => {
    const element = frameRef.current
    if (element === null) return
    let frame: number | null = null
    const observer = new ResizeObserver(() => {
      frame ??= requestAnimationFrame(() => {
        frame = null
        const width = element.getBoundingClientRect().width
        if (width > 0) setViewport(width)
      })
    })
    observer.observe(element)
    return () => {
      observer.disconnect()
      if (frame !== null) cancelAnimationFrame(frame)
    }
  }, [])

  const narrow = viewport < SIDEBAR_AUTO_COLLAPSE
  useEffect(() => {
    actions.setNarrow(narrow)
  }, [actions, narrow])

  const sidebarCollapsed = narrow ? !panels.narrowExpanded : panels.sidebar === 0
  const sidebarPreference = sidebarCollapsed ? 0 : panels.sidebar === 0 ? SIDEBAR_DEFAULT : panels.sidebar
  const columns = computeColumns(viewport, sidebarPreference, detailsSession === undefined ? 0 : panels.details)
  const columnsRef = useRef(columns)
  columnsRef.current = columns

  // The drag base is the RENDERED width captured at gesture start: grabbing a
  // concession-clamped panel must not jump back to the stored preference, and
  // freezing it for the gesture stops deltas from compounding.
  const sidebarBase = useRef(0)
  const detailsBase = useRef(0)
  const [dragging, setDragging] = useState(false)
  const onDragEnd = useCallback(() => setDragging(false), [])
  const onSidebarStart = useCallback(() => {
    sidebarBase.current = columnsRef.current.sidebar
    setDragging(true)
  }, [])
  const onDetailsStart = useCallback(() => {
    detailsBase.current = columnsRef.current.details
    setDragging(true)
  }, [])
  const onSidebarDrag = useCallback((dx: number) => actions.setSidebar(sidebarBase.current + dx), [actions])
  const onDetailsDrag = useCallback((dx: number) => actions.setDetails(detailsBase.current - dx), [actions])

  // Keep the operating system's own title in step with the rendered one, so the
  // window menu and task switcher agree with the frame.
  //
  // Optional rather than required: an older application paired with a newer
  // plugin simply does not serve the operation, and a stale entry in the window
  // menu is a far better outcome than refusing to present the frame at all.
  // There is no control to leave nonfunctional here — the effect is the feature.
  const canSetTitle = status.kind === 'ready' && status.capabilities.operations.includes('setWindowTitle')
  useEffect(() => {
    if (!canSetTitle) return
    void bridge?.setWindowTitle({ title }).catch(() => {
      // The window is gone or the request was superseded; the next title change
      // reapplies, and a stale native title is not worth surfacing.
    })
  }, [bridge, canSetTitle, title])

  const onWindowAction = useCallback(
    (action: 'minimize' | 'toggle-maximize' | 'close' | 'toggle-fullscreen') => {
      void bridge?.performWindowAction({ action }).catch(() => {
        // The window is already gone or the request was superseded; there is no
        // recovery a title-bar click can offer beyond leaving the frame as-is.
      })
    },
    [bridge],
  )

  return (
    <div
      ref={frameRef}
      className="dshd-frame"
      style={{ gridTemplateColumns: `${columns.sidebar}px minmax(0, 1fr) ${columns.details}px` }}
      data-sidebar-collapsed={sidebarCollapsed || undefined}
      data-details-collapsed={columns.details === 0 || undefined}
      data-dragging={dragging || undefined}
    >
      {status.kind === 'ready' ? (
        <TitleBar
          capabilities={status.capabilities}
          windowState={windowState}
          onAction={onWindowAction}
          title={title}
        />
      ) : (
        <div className="dshd-titleBar" />
      )}

      {status.kind === 'absent' || status.kind === 'incompatible' ? (
        <CompatibilitySurface status={status} />
      ) : (
        <>
          <div className="dshd-sidebarCol">
            {renderSlot('sidebar', { collapsed: sidebarCollapsed, width: columns.sidebar })}
          </div>
          <div className="dshd-centerCol">{renderSlot('conversation', {})}</div>
          <div className="dshd-detailsCol">{renderSlot('details', {})}</div>
          <div className="dshd-overlayLayer" data-shell-overlay>
            {renderSlot('shell.overlay', {})}
          </div>
          {/* A collapsed sidebar is a fixed-width rail, so it has no resize target. */}
          {!sidebarCollapsed && (
            <DragHandle
              side="sidebar"
              left={columns.sidebar}
              onStart={onSidebarStart}
              onDrag={onSidebarDrag}
              onEnd={onDragEnd}
            />
          )}
          {columns.details > 0 && (
            <DragHandle
              side="details"
              left={viewport - columns.details}
              onStart={onDetailsStart}
              onDrag={onDetailsDrag}
              onEnd={onDragEnd}
            />
          )}
        </>
      )}
    </div>
  )
}

/** One column drag handle: pointer capture with rAF-throttled delta reports. */
function DragHandle(props: {
  readonly side: 'sidebar' | 'details'
  readonly left: number
  readonly onStart: () => void
  readonly onDrag: (dx: number) => void
  readonly onEnd: () => void
}): ReactElement {
  const [dragging, setDragging] = useState(false)
  const origin = useRef(0)
  const latest = useRef(0)
  const frame = useRef<number | null>(null)
  const callbacks = useRef({ onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd })
  callbacks.current = { onStart: props.onStart, onDrag: props.onDrag, onEnd: props.onEnd }

  const onPointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    origin.current = event.clientX
    latest.current = event.clientX
    callbacks.current.onStart()
    setDragging(true)
  }, [])
  const onPointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    latest.current = event.clientX
    frame.current ??= requestAnimationFrame(() => {
      frame.current = null
      callbacks.current.onDrag(latest.current - origin.current)
    })
  }, [])
  const onPointerUp = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (!event.currentTarget.hasPointerCapture(event.pointerId)) return
    event.currentTarget.releasePointerCapture(event.pointerId)
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    callbacks.current.onDrag(latest.current - origin.current)
    setDragging(false)
    callbacks.current.onEnd()
  }, [])

  return (
    <div
      className="dshd-handle"
      style={{ left: props.left, top: TITLE_BAR_HEIGHT }}
      data-side={props.side}
      data-dragging={dragging || undefined}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    />
  )
}

/** Column grid wrapper, kept out of the frame body for readability. */
export function Column(props: { readonly area: string, readonly children?: ReactNode }): ReactElement {
  return <div className={props.area}>{props.children}</div>
}
