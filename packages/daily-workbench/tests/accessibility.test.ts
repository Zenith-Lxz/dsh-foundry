import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { WORKBENCH_CSS } from '../src/client/panels/styles.ts'

const PANELS = fileURLToPath(new URL('../src/client/panels', import.meta.url))
const sources = readdirSync(PANELS)
  .filter((name) => name.endsWith('.tsx'))
  .map((name) => ({ name, text: readFileSync(join(PANELS, name), 'utf8') }))

describe('every interactive control carries an unambiguous name', () => {
  it.each(sources.map((source) => [source.name, source.text] as const))(
    '%s gives each button either descriptive text or an aria-label',
    (_name, text) => {
      // The defect this catches is not a missing name but an ambiguous one: a
      // column of buttons all reading "diff" is announced identically, so a
      // keyboard user cannot tell which row they are on.
      const buttons = text.split('<button').slice(1)
      for (const button of buttons) {
        const head = button.slice(0, button.indexOf('</button>'))
        const generic = /\n\s*(diff|refresh|cancel|output|transcript|staged diff)\s*\n/.test(head)
        if (generic) expect(head, 'a generic label needs an aria-label').toMatch(/aria-label=/)
      }
    },
  )

  it('labels the plugin filter input for screen readers', () => {
    const plugins = sources.find((source) => source.name === 'PluginsPanel.tsx')!.text
    expect(plugins).toMatch(/dshw-visually-hidden/)
    expect(plugins).toMatch(/Filter plugins/)
  })
})

describe('the tab strip is a real tab list', () => {
  it('declares the roles and selection state assistive technology needs', () => {
    const workbench = sources.find((source) => source.name === 'Workbench.tsx')!.text
    expect(workbench).toMatch(/role="tablist"/)
    expect(workbench).toMatch(/role="tab"/)
    expect(workbench).toMatch(/role="tabpanel"/)
    expect(workbench).toMatch(/aria-selected=/)
  })

  it('names the tab list and each panel', () => {
    const workbench = sources.find((source) => source.name === 'Workbench.tsx')!.text
    expect(workbench).toMatch(/aria-label="Workbench"/)
    expect(workbench).toMatch(/aria-label=\{TAB_LABEL\[active\]\}/)
  })
})

describe('the stylesheet meets the interaction requirements', () => {
  it('gives every focusable control a visible focus ring', () => {
    // Focus that cannot be seen makes keyboard navigation guesswork.
    for (const selector of ['.dshw-tab:focus-visible', '.dshw-row-action:focus-visible', '.dshw-match:focus-visible']) {
      expect(WORKBENCH_CSS).toContain(selector)
    }
    expect(WORKBENCH_CSS).toMatch(/outline:\s*2px solid/)
  })

  it('honours a reduced-motion preference', () => {
    expect(WORKBENCH_CSS).toMatch(/@media \(prefers-reduced-motion: reduce\)/)
  })

  it('offers a class that hides text visually while keeping it announced', () => {
    expect(WORKBENCH_CSS).toMatch(/\.dshw-visually-hidden/)
    expect(WORKBENCH_CSS).toMatch(/clip-path: inset\(50%\)/)
  })

  it('defines every colour from an official token, with no literal fallback', () => {
    // A hardcoded colour behind a token name renders a light panel on a dark
    // theme and looks deliberate, which is how the title bar defect shipped.
    const fallbacks = WORKBENCH_CSS.match(/var\(--dsw-alias-[a-z-]+,\s*[^)]+\)/g) ?? []
    expect(fallbacks).toEqual([])
  })
})
