/**
 * Desktop directory-flow plugin, node half.
 *
 * Deliberately empty: the picking interaction is entirely browser-side, driven
 * through the Electron preload bridge. This half exists so the package appears
 * as a row in the desktop profile's composition and so the Loader can serve its
 * browser bundle through the `dsh.client` declaration.
 *
 * No host RPC is added and no official workspace code is changed: the occupant
 * reports its result through the slot owner's existing callbacks.
 * @module @dsh-foundry/native
 */

/** Host plugin body — this surface contributes no host behavior. */
export function apply(): void {}
