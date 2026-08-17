/**
 * The `ctx.layout` face.
 *
 * Replacing the root layout means inheriting its service obligations:
 * `ui-sidebar` and `ui-conversation` both inject `layout` and will not activate
 * without it. This is the same three-method contract the official layout
 * publishes, re-provided by the desktop frame.
 *
 * Panel geometry itself lives in the root entry's store; this face only carries
 * the transitions other plugins trigger, delivered as the registration's bound
 * actions.
 * @module @dsh-foundry/layout/client/layout-service
 */
import type { BoundActions } from '@deepseek-ai/dsh-client-ui-slots'
import type { createLayoutStore } from './store.ts'

/** The store's bound action set, with draft parameters already peeled by the framework. */
export type PanelActions = BoundActions<ReturnType<typeof createLayoutStore>>

/** The outward layout face other plugins reach for panel transitions. */
export interface ILayout {
  /** Toggle the sidebar panel (closed ⟷ contract default width). */
  toggleSidebar(): void
  /** Open the details panel; a no-op when already open. */
  openDetails(): void
  /** Close the details panel. */
  closeDetails(): void
}

/** Cross-plugin panel-action face provided as `ctx.layout`. */
export class DesktopLayoutController implements ILayout {
  #panels: PanelActions | undefined

  /**
   * Adopt the root entry's bound store actions.
   *
   * Called from the root registration's inject hook, so the face is live from
   * the entry's first render; re-registering overwrites the stale set.
   * @param actions - Bound actions of the entry's store instance.
   */
  attachPanels(actions: PanelActions): void {
    this.#panels = actions
  }

  /** Toggle the sidebar panel. */
  toggleSidebar(): void {
    this.#require().toggleSidebar()
  }

  /** Open the details panel. */
  openDetails(): void {
    this.#require().openDetails()
  }

  /** Close the details panel. */
  closeDetails(): void {
    this.#require().closeDetails()
  }

  /**
   * The wired actions.
   * @returns The bound action set.
   * @throws Error when the root entry has not mounted, which is a boot-order
   * bug rather than a race: every caller is a UI gesture, and a gesture cannot
   * precede the render that wires this face.
   */
  #require(): PanelActions {
    if (this.#panels === undefined) {
      throw new Error('layout: panel actions are not wired (the desktop root entry has not mounted)')
    }
    return this.#panels
  }
}
