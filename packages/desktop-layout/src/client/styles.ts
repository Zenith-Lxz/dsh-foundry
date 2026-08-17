/**
 * Owned stylesheet for the desktop frame.
 *
 * Every selector here targets an element this package renders, under a
 * `dshd-` prefix. Nothing styles an official component through its generated
 * class name or DOM structure.
 *
 * Colors come from the documented `--dsw-alias-*` design tokens — the same ones
 * the official frame uses — which the theme presenter applies to `body` from
 * each resolved snapshot. There are deliberately **no literal color fallbacks**:
 * a wrong guess at a token name would silently paint a light chrome over a dark
 * product, so a missing token must fall through to `transparent` or the
 * inherited color and stay invisible rather than wrong.
 * @module @dsh-foundry/layout/client/styles
 */
import { SIDEBAR_COLLAPSED, TITLE_BAR_HEIGHT, TRAFFIC_LIGHT_SAFE_WIDTH } from './columns.ts'

/** Identifies the style tag so re-evaluation cannot install a second copy. */
const STYLE_ID = '@dsh-foundry/layout'

/**
 * The frame stylesheet.
 *
 * Exported so a test can assert its theming invariants: token names must be
 * real, and no color may fall back to a literal that would paint light chrome
 * over a dark product.
 */
export const FRAME_CSS = `
.dshd-frame {
  position: relative;
  display: grid;
  grid-template-rows: ${TITLE_BAR_HEIGHT}px minmax(0, 1fr);
  grid-template-areas: "title title title" "sidebar center details";
  height: 100vh;
  width: 100vw;
  overflow: hidden;
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
}
.dshd-frame:not([data-dragging]) {
  transition: grid-template-columns var(--ds-transition-duration-slow, .25s) var(--ds-ease-in-out, ease);
}

.dshd-titleBar {
  grid-area: title;
  display: flex;
  align-items: center;
  gap: 8px;
  height: ${TITLE_BAR_HEIGHT}px;
  padding: 0 8px;
  /* The bar is part of the frame surface, not a separate chrome: it takes the
     same base fill so the window reads as one piece in either color scheme. */
  background: var(--dsw-alias-bg-base);
  border-bottom: 1px solid var(--dsw-alias-border-l1);
  /* The bar itself is the drag region; every interactive child opts out. */
  -webkit-app-region: drag;
  app-region: drag;
  user-select: none;
}
/* macOS keeps its traffic lights in the window's top-left corner. Reserving
   the space here is what keeps them clickable at every window size. */
.dshd-titleBar[data-platform="darwin"] { padding-left: ${TRAFFIC_LIGHT_SAFE_WIDTH}px; }
.dshd-titleBar[data-platform="darwin"][data-fullscreen="true"] { padding-left: 8px; }

/* 13px semibold matches the metrics both platforms use for a window title, so
   the frame does not read as a web page wearing a title bar. The family comes
   from the theme's own stack, which resolves to the platform UI font. */
.dshd-title {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-family: var(--dsw-font-family);
  font-size: 13px;
  font-weight: 600;
  letter-spacing: .01em;
  text-align: center;
  /* Inactive is the default state so a window that never reports focus reads as
     inactive rather than falsely prominent. */
  color: var(--dsw-alias-label-tertiary);
  transition: color var(--ds-transition-duration-fast, .12s) var(--ds-ease-in-out, ease);
}
.dshd-titleBar[data-focused="true"] .dshd-title { color: var(--dsw-alias-label-primary); }

.dshd-caption { display: flex; align-items: stretch; height: 100%; }
.dshd-captionButton {
  -webkit-app-region: no-drag;
  app-region: no-drag;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 46px;
  height: 100%;
  border: 0;
  padding: 0;
  background: transparent;
  color: var(--dsw-alias-label-secondary);
  cursor: default;
}
.dshd-captionButton:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshd-captionButton:focus-visible {
  outline: 2px solid var(--dsw-alias-brand-primary);
  outline-offset: -2px;
}
/* The close control keeps the Windows convention of a red destructive hover,
   which is a platform affordance rather than a theme color. */
.dshd-captionButton[data-variant="close"]:hover { background: #c42b1c; color: #ffffff; }
.dshd-captionButton svg { pointer-events: none; }

.dshd-sidebarCol { grid-area: sidebar; min-width: 0; overflow: hidden; }
.dshd-centerCol { grid-area: center; min-width: 0; display: flex; flex-direction: column; overflow: hidden; }
.dshd-detailsCol { grid-area: details; min-width: 0; overflow: hidden; }
.dshd-frame[data-sidebar-collapsed] .dshd-sidebarCol { width: ${SIDEBAR_COLLAPSED}px; }

.dshd-overlayLayer {
  position: absolute;
  inset: ${TITLE_BAR_HEIGHT}px 0 0 0;
  pointer-events: none;
  z-index: 40;
}
.dshd-overlayLayer > * { pointer-events: auto; }

.dshd-handle {
  position: absolute;
  top: ${TITLE_BAR_HEIGHT}px;
  bottom: 0;
  width: 10px;
  margin-left: -5px;
  cursor: col-resize;
  z-index: 30;
  -webkit-app-region: no-drag;
  app-region: no-drag;
}
.dshd-handle::after {
  content: "";
  position: absolute;
  top: 0;
  bottom: 0;
  left: 4px;
  width: 2px;
  background: transparent;
  transition: background var(--ds-transition-duration-fast, .12s) var(--ds-ease-in-out, ease);
}
.dshd-handle:hover::after,
.dshd-handle[data-dragging]::after { background: var(--dsw-alias-border-l3); }

.dshd-compat {
  grid-area: sidebar / sidebar / details / details;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}
.dshd-compatCard {
  max-width: 34em;
  padding: 1.5rem 1.75rem;
  border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 12px;
  background: var(--dsw-alias-bg-layer-1);
}
.dshd-compatCard h1 { margin: 0 0 .3rem; font-size: 1rem; font-weight: 600; color: var(--dsw-alias-label-primary); }
.dshd-compatCard h2 { margin: 0 0 1rem; font-size: .9rem; font-weight: 500; color: var(--dsw-alias-label-secondary); }
.dshd-compatCard p { margin: .35rem 0; font-size: .82rem; color: var(--dsw-alias-label-secondary); }
.dshd-compatCard code {
  font-family: var(--ds-font-family-code, ui-monospace, monospace);
  font-size: .78rem;
}

@media (prefers-reduced-motion: reduce) {
  .dshd-frame, .dshd-handle::after { transition: none; }
}
`

/**
 * Install the frame stylesheet once.
 *
 * Idempotent under re-evaluation: the loader may materialize this bundle again
 * after an HMR replacement, and a second tag would not be removed by the first
 * disposer.
 * @returns A disposer removing the owned style tag.
 */
export function installStyles(): () => void {
  const existing = document.querySelector(`style[data-plugin-css="${STYLE_ID}"]`)
  if (existing !== null) return () => existing.remove()
  const tag = document.createElement('style')
  tag.dataset['plugin'] = STYLE_ID
  tag.dataset['pluginCss'] = STYLE_ID
  tag.textContent = FRAME_CSS
  document.head.append(tag)
  return () => tag.remove()
}
