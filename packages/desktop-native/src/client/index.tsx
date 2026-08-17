/**
 * Desktop directory-flow plugin, browser half.
 *
 * Registers one renderless occupant into both public workspace directory-flow
 * slots. The two registrations install as a single transactional effect through
 * nested `slots.inject()` calls, because either declaring entry may activate
 * later or replace its declaration.
 *
 * The occupant calls the Electron bridge instead of the host's own chooser, so
 * the dialog is a real native window parented to the application window. The
 * selected path crosses the bridge as an opaque native string and is handed to
 * the owner unchanged: no POSIX/Windows conversion, no URI coercion.
 * @module @dsh-foundry/native/client
 */
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
// Type-only: pulls the SlotMap merge that declares the directory-flow slots.
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { DesktopDirectoryFlow, type DesktopFlowInjected } from './flow.tsx'
import { desktopBridge } from './bridge.ts'

/** Required services: the slot registry. The chooser itself is the preload bridge, not a service. */
export const inject = ['slots']

/**
 * Client plugin body.
 * @param ctx - Client root context.
 */
export function apply(ctx: ClientContext): void {
  const injected = (): DesktopFlowInjected => ({
    pick: async () => {
      const bridge = desktopBridge()
      if (bridge === undefined) {
        // This package is only composed into the desktop profile. Reaching here
        // means the profile was booted in an ordinary browser, which the owner's
        // error surface should state rather than silently doing nothing.
        throw new Error('the desktop native bridge is unavailable in this browser')
      }
      const result = await bridge.pickDirectory({ requestId: crypto.randomUUID() })
      return result.outcome === 'picked' ? result.path : null
    },
  })

  ctx.slots.inject('conversation.hero.workspace.directoryFlow', () =>
    ctx.slots.inject('sidebar.workspaces.directoryFlow', function* () {
      yield ctx.slots.register(
        { name: 'conversation.hero.workspace.directoryFlow', inject: injected },
        DesktopDirectoryFlow,
      )
      yield ctx.slots.register(
        { name: 'sidebar.workspaces.directoryFlow', inject: injected },
        DesktopDirectoryFlow,
      )
    }))
}
