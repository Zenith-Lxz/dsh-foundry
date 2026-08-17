/**
 * The mounted Host face, published to the render tree.
 *
 * A slot occupant cannot read `ctx.remote.dshWorkbench` for itself. Cordis
 * refuses a property read on a service the reading fiber never injected, and
 * this plugin is what mounts that namespace, so injecting it at the top level
 * would deadlock the fiber on a service only its own body can create. The
 * plugin body resolves it once in a child scope and publishes it here.
 *
 * A plain mutable variable would not do: the namespace appears asynchronously,
 * and a React tree mounted before it does would keep rendering the unavailable
 * state forever with nothing to invalidate it. This is the same snapshot-store
 * arrangement the official client uses for values that settle late.
 * @module @dsh-foundry/daily-workbench/client/remote-holder
 */

/**
 * A value published to React that settles once, after the tree may already exist.
 *
 * The members are function-valued properties, not methods. `useSyncExternalStore`
 * takes them detached from the holder, and a method declaration would promise a
 * `this` the caller does not pass.
 */
export interface RemoteHolder<T> {
  /** Current value, or `undefined` until it settles. */
  readonly getSnapshot: () => T | undefined
  /** Watch for the value settling; returns the unsubscribe function. */
  readonly subscribe: (listener: () => void) => () => void
  /** Publish the value. */
  readonly set: (value: T) => void
}

/**
 * Create an empty holder.
 * @returns The holder.
 */
export function createRemoteHolder<T>(): RemoteHolder<T> {
  let current: T | undefined
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => current,
    subscribe: (listener) => {
      listeners.add(listener)
      return () => {
        listeners.delete(listener)
      }
    },
    set: (value) => {
      current = value
      for (const listener of listeners) listener()
    },
  }
}
