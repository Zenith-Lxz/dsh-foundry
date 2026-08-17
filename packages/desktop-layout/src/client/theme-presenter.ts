/**
 * Global theme applier.
 *
 * Replacing the root layout also inherits theme presentation: the official
 * layout seats it, so a replacement that omits it leaves the product with no
 * palette at all. It projects the resolved snapshot onto the document —
 * `color-scheme` on the root element for native browser chrome, the dark
 * palette attribute on `body`, the active theme's alias tokens as inline CSS
 * variables, and one owned `theme-color` metadata node.
 *
 * Pure DOM writes with no React path. The presenter retracts only what it
 * wrote, so foreign attributes, metadata, and inline styles survive both apply
 * and dispose.
 * @module @dsh-foundry/layout/client/theme-presenter
 */
import type { ThemeSnapshot } from '@deepseek-ai/dsh-client-ui-theme/client'

/** Body attribute selecting the dark base palette in the token stylesheets. */
export const DARK_ATTRIBUTE = 'data-ds-dark-theme'

/** Applies theme snapshots to the document; one instance per plugin fiber. */
export class ThemePresenter {
  /** Token names written by the last apply, which is this presenter's retraction set. */
  #appliedTokens: string[] = []
  /** The single metadata node this presenter inserts and removes. */
  readonly #themeColorMeta: HTMLMetaElement

  /** Create the owned metadata node before the first snapshot arrives. */
  constructor() {
    this.#themeColorMeta = document.createElement('meta')
    this.#themeColorMeta.name = 'theme-color'
  }

  /**
   * Project one snapshot onto the document.
   *
   * The color scheme comes from `active.colorScheme`, never the theme id:
   * `system` is already resolved upstream. Theme-color metadata is read from
   * the computed background *after* the token writes, so the rendered palette
   * stays the single color authority.
   * @param snapshot - Resolved theme snapshot from `ctx.theme`.
   */
  apply(snapshot: ThemeSnapshot): void {
    const scheme = snapshot.active.colorScheme
    document.documentElement.style.colorScheme = scheme
    const body = document.body
    if (scheme === 'dark') body.setAttribute(DARK_ATTRIBUTE, '')
    else body.removeAttribute(DARK_ATTRIBUTE)

    for (const name of this.#appliedTokens) body.style.removeProperty(name)
    this.#appliedTokens = []
    for (const [name, value] of Object.entries(snapshot.active.tokens)) {
      body.style.setProperty(name, value)
      this.#appliedTokens.push(name)
    }

    this.#themeColorMeta.content = getComputedStyle(body).backgroundColor
    if (!this.#themeColorMeta.isConnected) document.head.append(this.#themeColorMeta)
  }

  /** Retract the color scheme, palette attribute, token variables, and owned metadata node. */
  dispose(): void {
    document.documentElement.style.removeProperty('color-scheme')
    const body = document.body
    body.removeAttribute(DARK_ATTRIBUTE)
    for (const name of this.#appliedTokens) body.style.removeProperty(name)
    this.#appliedTokens = []
    this.#themeColorMeta.remove()
  }
}
