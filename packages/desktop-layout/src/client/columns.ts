/**
 * Column geometry for the desktop frame.
 *
 * The concession chain is fixed: keep the center column above its floor by
 * shrinking details, then by closing details, and only then let the center
 * absorb the remaining deficit. The sidebar never concedes — its rendered
 * width is the drag preference or the collapsed rail.
 *
 * The solver is pure and free of hysteresis: widths are a function of
 * `(viewport, preferences)` alone, so re-widening the window restores the
 * previous layout without storing a recovery state. A derived auto-close never
 * rewrites the stored preference, which is why the panel comes back.
 *
 * These values match the official Web frame so replacing the root layout does
 * not change how the official conversation and tool surfaces lay out.
 * @module @dsh-foundry/layout/client/columns
 */

/** Resolved widths for one frame. */
export interface Columns {
  readonly sidebar: number
  readonly center: number
  readonly details: number
}

/** Center column floor; only the final fallback goes below it. */
export const CENTER_MIN = 640
/** Sidebar drag clamp floor. */
export const SIDEBAR_MIN = 264
/** Sidebar drag clamp ceiling. */
export const SIDEBAR_MAX = 420
/** Sidebar width before any user drag. */
export const SIDEBAR_DEFAULT = 280
/** Closed-sidebar control rail width. */
export const SIDEBAR_COLLAPSED = 56
/** Viewport width below which the sidebar auto-collapses to the rail. */
export const SIDEBAR_AUTO_COLLAPSE = 1024
/** Details drag clamp floor. */
export const DETAILS_MIN = 300
/** Details drag clamp ceiling. */
export const DETAILS_MAX = 520
/** Details width before any user drag. */
export const DETAILS_DEFAULT = 360

/** Height of the desktop title bar, which the frame reserves above every column. */
export const TITLE_BAR_HEIGHT = 38
/**
 * Horizontal space the macOS traffic lights occupy, measured from the window's
 * left edge. Content and drag regions must not cover it, or the operating
 * system's own window controls become unclickable.
 */
export const TRAFFIC_LIGHT_SAFE_WIDTH = 78

/**
 * Clamp a panel width into its contract range.
 * @param px - Requested width.
 * @param min - Range lower bound.
 * @param max - Range upper bound.
 * @returns The clamped, rounded width.
 */
export function clampWidth(px: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, Math.round(px)))
}

/**
 * Solve the three column widths for one frame.
 * @param viewport - Available frame width in px.
 * @param sidebar - Sidebar width preference in px (0 = closed).
 * @param details - Details width preference in px (0 = closed).
 * @returns Resolved widths; `details: 0` is visually closed, never unmounted.
 */
export function computeColumns(viewport: number, sidebar: number, details: number): Columns {
  const resolvedSidebar = sidebar === 0 ? SIDEBAR_COLLAPSED : clampWidth(sidebar, SIDEBAR_MIN, SIDEBAR_MAX)
  const preferredDetails = details === 0 ? 0 : clampWidth(details, DETAILS_MIN, DETAILS_MAX)

  if (resolvedSidebar + preferredDetails + CENTER_MIN <= viewport) {
    return {
      sidebar: resolvedSidebar,
      center: viewport - resolvedSidebar - preferredDetails,
      details: preferredDetails,
    }
  }

  const shrunkDetails = preferredDetails === 0
    ? 0
    : Math.max(DETAILS_MIN, viewport - resolvedSidebar - CENTER_MIN)
  if (resolvedSidebar + shrunkDetails + CENTER_MIN <= viewport) {
    return { sidebar: resolvedSidebar, center: CENTER_MIN, details: shrunkDetails }
  }

  return { sidebar: resolvedSidebar, center: Math.max(0, viewport - resolvedSidebar), details: 0 }
}
