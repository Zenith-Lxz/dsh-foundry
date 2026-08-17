/**
 * Desktop layout plugin, browser half.
 *
 * Replaces the official root layout through public composition only: the
 * desktop Bundle disables the `ui-layout` row and this package registers into
 * the runtime-owned `root` slot in its place.
 *
 * Replacing that row means inheriting everything it owned, which is why this
 * one `apply` does four things rather than one:
 *
 * - provides `ctx.layout`, because `ui-sidebar` and `ui-conversation` inject it
 *   and will not activate without it;
 * - re-declares the four child slots (`sidebar`, `conversation`, `details`,
 *   `shell.overlay`) with the same kinds and scopes, because official plugins
 *   register into them and a slot with no declaring entry is unregisterable;
 * - seats a theme presenter, because theme projection lived with the root
 *   layout and its absence leaves the product unstyled;
 * - installs its own stylesheet.
 *
 * The official sidebar, conversation, details, and overlay occupants render
 * unchanged inside the new frame. No official component is copied, no generated
 * class name is targeted, and no private DOM is queried.
 * @module @dsh-foundry/layout/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge for the theme service contract.
import type {} from '@deepseek-ai/dsh-client-ui-theme/client'
import { DesktopFrame } from './DesktopFrame.tsx'
import { DesktopLayoutController, type PanelActions } from './layout-service.ts'
import { createLayoutStore } from './store.ts'
import { ThemePresenter } from './theme-presenter.ts'
import { installStyles } from './styles.ts'

export { DesktopLayoutController } from './layout-service.ts'
export type { ILayout } from './layout-service.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** The outward panel-action face; the concrete controller stays inside this plugin. */
    layout: import('./layout-service.ts').ILayout
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /**
     * The whole left column, occupied by the official sidebar. The occupant
     * receives the frame's live column state and renders the compact control
     * rail while collapsed.
     */
    'sidebar': { kind: 'single', scope: 'root', owner: SidebarOwnerProps }
    /** The whole center column, across both the no-session hero and a live conversation. */
    'conversation': { kind: 'single', scope: 'session-maybe', owner: ConversationOwnerProps }
    /** The right details column; the frame owns whether it is open. */
    'details': { kind: 'single', scope: 'session', owner: DetailsOwnerProps }
    /** Frame-wide floating layer above every column, click-through until an entry opts in. */
    'shell.overlay': { kind: 'list', scope: 'root' }
  }
}

/** Sidebar owner share: live column state from the frame's concession solve. */
export interface SidebarOwnerProps {
  /** True when the sidebar is closed and the column renders its compact rail. */
  collapsed: boolean
  /** Rendered column width in px. */
  width: number
}

/** Conversation owner share: business state belongs to the registrant. */
export type ConversationOwnerProps = Record<never, never>

/** Details owner share: the session id arrives as a framework-standard prop. */
export type DetailsOwnerProps = Record<never, never>

/** Required services. */
export const inject = ['slots', 'theme']

/**
 * Client plugin body.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  ctx.effect(() => installStyles(), 'desktop-layout: stylesheet')

  ctx.effect(() => {
    const layout = new DesktopLayoutController()
    const disposeService = ctx.reflect.provide('layout', layout)
    const disposeRegistration = ctx.slots.register({
      name: 'root',
      children: {
        'sidebar': { kind: 'single', scope: 'root' },
        'conversation': { kind: 'single', scope: 'session-maybe' },
        'details': { kind: 'single', scope: 'session' },
        'shell.overlay': { kind: 'list', scope: 'root' },
      },
      store: createLayoutStore,
      inject: (actions: PanelActions) => {
        layout.attachPanels(actions)
        return {}
      },
    }, DesktopFrame)
    return () => {
      disposeRegistration()
      // provide()'s disposer settles asynchronously while teardown is
      // synchronous, so this is deliberately fire-and-forget.
      void disposeService()
    }
  }, 'desktop-layout: service + root registration')

  ctx.effect(() => {
    // Theme projection is pure DOM writes: the current snapshot once through
    // the getter, then event-driven only, with no React path.
    const presenter = new ThemePresenter()
    presenter.apply(ctx.theme.getTheme())
    const off = ctx.on('theme/change', (snapshot) => {
      presenter.apply(snapshot)
    })
    return () => {
      off()
      presenter.dispose()
    }
  }, 'desktop-layout: theme presenter')
}
