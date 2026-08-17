/**
 * The root layout re-declares every official child slot, and its chrome opts
 * out of the drag region wherever the user must click.
 *
 * Replacing the official root layout is the most invasive thing this
 * distribution does through public composition, and it is only safe if the
 * replacement re-declares every child slot the official occupants target.
 * Omitting one does not error: the occupant simply never renders, which reads
 * as a missing feature rather than a broken layout.
 *
 * Asserted against the source and the stylesheet rather than by executing
 * `apply`. The plugin's runtime dependency is a browser loader bundle that
 * cannot be imported under Node, and mocking the official runtime to reach a
 * declaration that is a literal in the source would test the mock.
 * @module packages/desktop-layout/tests/registration.test
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')

const entry = read('../src/client/index.tsx')
const styles = read('../src/client/styles.ts')

describe('the root registration re-declares every official child slot', () => {
  it('registers the root owner exactly once', () => {
    expect([...entry.matchAll(/name:\s*'root'/g)]).toHaveLength(1)
  })

  it('declares the four child slots official plugins occupy', () => {
    const children = entry.slice(entry.indexOf('children: {'), entry.indexOf('store:'))
    for (const slot of ['sidebar', 'conversation', 'details', 'shell.overlay']) {
      expect(children, `child slot ${slot} is not re-declared`).toContain(`'${slot}'`)
    }
  })

  it('keeps each child slot’s kind and scope as the official layout declares them', () => {
    const children = entry.slice(entry.indexOf('children: {'), entry.indexOf('store:'))
    expect(children).toMatch(/'sidebar':\s*\{\s*kind:\s*'single',\s*scope:\s*'root'\s*\}/)
    expect(children).toMatch(/'conversation':\s*\{\s*kind:\s*'single',\s*scope:\s*'session-maybe'\s*\}/)
    expect(children).toMatch(/'details':\s*\{\s*kind:\s*'single',\s*scope:\s*'session'\s*\}/)
    // The overlay is a list: more than one plugin contributes to it.
    expect(children).toMatch(/'shell\.overlay':\s*\{\s*kind:\s*'list',\s*scope:\s*'root'\s*\}/)
  })

  it('provides the layout service the official tree reads', () => {
    expect(entry).toMatch(/provide\('layout'/)
  })
})

describe('every registration is undone on disposal', () => {
  it('returns a teardown from each effect that registers something', () => {
    // A leaked registration or service survives an unmount and collides with
    // the next one, failing far from where it was created.
    expect(entry).toContain('disposeRegistration()')
    expect(entry).toContain('void disposeService()')
    expect(entry).toContain('presenter.dispose()')
  })

  it('labels every effect, so a pending scope names itself', () => {
    const labels = [...entry.matchAll(/ctx\.effect\([\s\S]*?'(desktop-layout: [^']+)'/g)].map((m) => m[1])
    expect(labels.length).toBeGreaterThanOrEqual(3)
  })
})

describe('the drag region stops where the user must click', () => {
  it('makes the title bar draggable', () => {
    expect(styles).toMatch(/app-region:\s*drag/)
  })

  it('opts every interactive child out of dragging', () => {
    // A control inside a drag region moves the window instead of activating,
    // which reads as a dead button.
    const optOuts = [...styles.matchAll(/app-region:\s*no-drag/g)]
    expect(optOuts.length).toBeGreaterThanOrEqual(2)
  })

  it('pairs each region rule with its vendor-prefixed form', () => {
    // Electron on macOS still reads the prefixed property; shipping only the
    // standard one makes the whole title bar non-draggable.
    expect([...styles.matchAll(/-webkit-app-region:/g)].length)
      .toBe([...styles.matchAll(/(?<!-)app-region:/g)].length)
  })
})
