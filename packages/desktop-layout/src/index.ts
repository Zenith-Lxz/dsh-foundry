/**
 * Desktop layout plugin, node half.
 *
 * Empty by design: the frame is entirely browser-side. This half exists so the
 * package appears as a row in the desktop profile's composition and so the
 * Loader serves its browser bundle through the `dsh.client` declaration.
 * @module @dsh-foundry/layout
 */

/** Host plugin body — this surface contributes no host behavior. */
export function apply(): void {}
