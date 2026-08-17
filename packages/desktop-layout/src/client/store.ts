/**
 * The root entry's transient panel store.
 *
 * Panel geometry is plain widths in px, where `0` means closed — the
 * preference *is* the width, so closing a panel forgets its dragged width and
 * reopening restores the contract default.
 *
 * The factory is exported rather than a store instance: a module-level handle
 * would pin store identity in the module cache and survive plugin reloads as a
 * de-facto singleton. The framework instantiates one per entry.
 * @module @dsh-foundry/layout/client/store
 */
import { defineStore, type EngineStoreHandle } from '@deepseek-ai/dsh-client-runtime/client'
import {
  clampWidth,
  DETAILS_DEFAULT,
  DETAILS_MAX,
  DETAILS_MIN,
  SIDEBAR_DEFAULT,
  SIDEBAR_MAX,
  SIDEBAR_MIN,
} from './columns.ts'

/**
 * Panel widths plus the narrow-viewport pair.
 *
 * `narrow` mirrors the frame's breakpoint reading so the sidebar toggle can
 * pick its semantics, and `narrowExpanded` is the manual override that
 * re-expands an auto-collapsed sidebar over the squeezed center without
 * rewriting the width preference.
 */
export interface LayoutState {
  sidebar: number
  details: number
  narrow: boolean
  narrowExpanded: boolean
}

/**
 * The complete write set.
 *
 * A type alias rather than an interface: the store contract is constrained by an
 * index signature, and only an alias carries the implicit one.
 */
type LayoutActions = {
  setSidebar: (draft: LayoutState, px: number) => void
  setDetails: (draft: LayoutState, px: number) => void
  toggleSidebar: (draft: LayoutState) => void
  setNarrow: (draft: LayoutState, narrow: boolean) => void
  openDetails: (draft: LayoutState) => void
  closeDetails: (draft: LayoutState) => void
}

/**
 * Create the panel store handle.
 * @returns The store handle: spec, type, identity, and factory in one.
 */
export function createLayoutStore(): EngineStoreHandle<LayoutState, LayoutActions> {
  return defineStore({
    init: (): LayoutState => ({ sidebar: SIDEBAR_DEFAULT, details: 0, narrow: false, narrowExpanded: false }),
    actions: {
      setSidebar: (draft, px: number) => {
        draft.sidebar = clampWidth(px, SIDEBAR_MIN, SIDEBAR_MAX)
      },
      setDetails: (draft, px: number) => {
        draft.details = clampWidth(px, DETAILS_MIN, DETAILS_MAX)
      },
      // Below the breakpoint the toggle flips only the override, so the width
      // preference survives and re-widening restores the pre-squeeze layout.
      toggleSidebar: (draft) => {
        if (draft.narrow) draft.narrowExpanded = !draft.narrowExpanded
        else draft.sidebar = draft.sidebar === 0 ? SIDEBAR_DEFAULT : 0
      },
      // Crossing the breakpoint in either direction drops the override: narrow
      // defaults to collapsed, wide defaults to the stored preference.
      setNarrow: (draft, narrow: boolean) => {
        if (draft.narrow === narrow) return
        draft.narrow = narrow
        draft.narrowExpanded = false
      },
      openDetails: (draft) => {
        if (draft.details === 0) draft.details = DETAILS_DEFAULT
      },
      closeDetails: (draft) => {
        draft.details = 0
      },
    },
  })
}
