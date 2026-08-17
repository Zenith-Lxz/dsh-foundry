/**
 * The platform title bar.
 *
 * Neither platform emulates the other. macOS keeps the operating system's own
 * traffic lights and this bar only reserves their safe area plus a
 * double-click zoom target. Windows has no native caption in this window, so
 * this bar renders minimize, maximize/restore, and close controls whose state
 * follows real `BrowserWindow` events rather than the frame's own guesses.
 *
 * The bar is a drag region; every interactive control opts back out with
 * `app-region: no-drag`, which is what keeps a click on a button from being
 * swallowed by a window drag.
 * @module @dsh-foundry/layout/client/TitleBar
 */
import type { ReactElement } from 'react'
import type { DesktopCapabilitiesV1, WindowStateV1 } from '@dsh-foundry/contract'

/** What the title bar needs to render and drive one platform's chrome. */
export interface TitleBarProps {
  readonly capabilities: DesktopCapabilitiesV1
  readonly windowState: WindowStateV1
  /** Perform a window action; rejections are surfaced by the caller's error path. */
  readonly onAction: (action: 'minimize' | 'toggle-maximize' | 'close' | 'toggle-fullscreen') => void
  /** Centered label. */
  readonly title: string
}

/**
 * Render the platform title bar.
 * @param props - Capabilities, live window state, action dispatcher, and title.
 * @returns The title bar element.
 */
export function TitleBar({ capabilities, windowState, onAction, title }: TitleBarProps): ReactElement {
  const isMac = capabilities.windowControls === 'macos-traffic-lights'
  return (
    <div
      className="dshd-titleBar"
      data-platform={capabilities.platform}
      data-fullscreen={windowState.fullScreen ? 'true' : undefined}
      // Both platforms dim an inactive window's title. Carrying the flag as an
      // attribute keeps the rule in the stylesheet next to the rest of the
      // title treatment instead of splitting it across a style object.
      data-focused={windowState.focused ? 'true' : undefined}
      // macOS convention: double-clicking the title area zooms the window.
      // Windows uses the same gesture for maximize/restore, and both map onto
      // the one validated toggle the bridge exposes.
      onDoubleClick={() => onAction('toggle-maximize')}
    >
      <div className="dshd-title">{title}</div>
      {isMac ? null : (
        <div className="dshd-caption">
          <CaptionButton
            variant="minimize"
            label="Minimize"
            labelZh="最小化"
            onClick={() => onAction('minimize')}
          />
          <CaptionButton
            variant="maximize"
            label={windowState.maximized ? 'Restore' : 'Maximize'}
            labelZh={windowState.maximized ? '还原' : '最大化'}
            maximized={windowState.maximized}
            onClick={() => onAction('toggle-maximize')}
          />
          <CaptionButton
            variant="close"
            label="Close"
            labelZh="关闭"
            onClick={() => onAction('close')}
          />
        </div>
      )}
    </div>
  )
}

/** One Windows caption control. */
function CaptionButton(props: {
  readonly variant: 'minimize' | 'maximize' | 'close'
  readonly label: string
  readonly labelZh: string
  readonly maximized?: boolean
  readonly onClick: () => void
}): ReactElement {
  return (
    <button
      type="button"
      className="dshd-captionButton"
      data-variant={props.variant}
      // Both languages ride one accessible name because a desktop caption has
      // no room for a visible label and the product ships to both audiences.
      aria-label={`${props.labelZh} / ${props.label}`}
      title={`${props.labelZh} / ${props.label}`}
      onClick={props.onClick}
    >
      <CaptionGlyph variant={props.variant} maximized={props.maximized === true} />
    </button>
  )
}

/** The 10x10 caption glyphs, drawn to the Windows caption metrics. */
function CaptionGlyph(props: { readonly variant: string, readonly maximized: boolean }): ReactElement {
  const stroke = { fill: 'none', stroke: 'currentColor', strokeWidth: 1 }
  if (props.variant === 'minimize') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 5.5h10" {...stroke} />
      </svg>
    )
  }
  if (props.variant === 'close') {
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
        <path d="M0 0l10 10M10 0L0 10" {...stroke} />
      </svg>
    )
  }
  // The restore glyph is the two-rectangle stack, so the control reads as
  // "return to the previous size" rather than as a second maximize.
  return props.maximized ? (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <path d="M2.5 0.5h7v7h-2" {...stroke} />
      <rect x="0.5" y="2.5" width="7" height="7" {...stroke} />
    </svg>
  ) : (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true">
      <rect x="0.5" y="0.5" width="9" height="9" {...stroke} />
    </svg>
  )
}
