import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { FRAME_CSS } from '../src/client/styles.ts'

/**
 * The design tokens the theme presenter applies to `body`.
 *
 * Read from the shipped `@deepseek-ai/dsh-client-ui-theme` stylesheets rather
 * than restated here: a token this build invents is exactly the defect these
 * tests exist to catch, and a hand-copied list would drift the same way.
 */
const themeTokens = (() => {
  // Whichever target this host staged: the token names are the same across
  // targets, and hardcoding one would make this check pass vacuously on the
  // other platform's CI runner.
  const names = new Set<string>()
  for (const target of ['darwin-arm64', 'win32-x64']) {
    const base = fileURLToPath(new URL(
      `../../../stage/${target}/runtime/node_modules/@deepseek-ai/dsh-client-ui-theme/lib/styles/`,
      import.meta.url,
    ))
    for (const file of ['design-platform.css', 'base.css']) {
    let text: string
    try {
      text = readFileSync(`${base}${file}`, 'utf8')
    } catch {
      // The stage is optional for a plain unit run; an absent stylesheet leaves
      // the set empty and the guard below skips rather than asserting falsely.
      continue
    }
    for (const match of text.matchAll(/(--[a-z0-9-]+)\s*:/g)) {
      const name = match[1]
      if (name !== undefined) names.add(name)
    }
    }
  }
  return names
})()

/**
 * Matches a literal color value.
 *
 * The name lookarounds keep CSS properties that merely start with a color word
 * — `white-space` is the one that actually occurs here — from reading as colors.
 */
const COLOR_LITERAL = /#[0-9a-fA-F]{3,8}\b|(?<![-a-zA-Z])(?:white|black)(?![-a-zA-Z])|\brgba?\(/

/** Custom properties referenced by the frame stylesheet. */
const referenced = [...FRAME_CSS.matchAll(/var\((--[a-z0-9-]+)/g)].map((match) => match[1] ?? '')

describe('the frame stylesheet only uses real theme tokens', () => {
  it('references at least the frame surface, border, and label tokens', () => {
    for (const required of [
      '--dsw-alias-bg-base',
      '--dsw-alias-border-l1',
      '--dsw-alias-label-primary',
      '--dsw-alias-label-secondary',
    ]) {
      expect(referenced).toContain(required)
    }
  })

  it('references no token the shipped theme does not define', () => {
    if (themeTokens.size === 0) {
      expect(themeTokens.size, 'stage the runtime to run this check against real tokens').toBe(0)
      return
    }
    const unknown = [...new Set(referenced)].filter((name) => !themeTokens.has(name))
    expect(unknown, `these custom properties are not defined by the shipped theme: ${unknown.join(', ')}`).toEqual([])
  })
})

describe('no color falls back to a literal that would fight the theme', () => {
  /**
   * A `var(--token, <fallback>)` whose fallback is a literal color paints that
   * literal whenever the token is absent — which is how a light title bar ends
   * up over a dark product. Non-color fallbacks (durations, easings, font
   * stacks) are fine and are what the allowance below covers.
   */
  it('uses no hex or named color as a var() fallback', () => {
    const fallbacks = [...FRAME_CSS.matchAll(/var\(--[a-z0-9-]+\s*,\s*([^)]*)\)/g)].map((match) => match[1] ?? '')
    const colorLike = fallbacks.filter((value) => COLOR_LITERAL.test(value))
    expect(colorLike, `color fallbacks found: ${colorLike.join(' | ')}`).toEqual([])
  })

  it('carries no bare light literal outside the documented Windows close affordance', () => {
    const lines = FRAME_CSS.split('\n')
    const offenders = lines.filter((line) => {
      if (!COLOR_LITERAL.test(line)) return false
      // The Windows close control's red destructive hover is a platform
      // affordance, not a theme color, and is documented as such at its site.
      return !line.includes('data-variant="close"')
    })
    expect(offenders, `unexpected literal colors: ${offenders.join(' | ')}`).toEqual([])
  })
})
