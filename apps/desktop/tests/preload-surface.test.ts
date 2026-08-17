/**
 * The renderer receives the declared bridge and nothing else.
 *
 * Context isolation only helps if the preload exposes a closed surface. Handing
 * out `ipcRenderer`, or a bridge carrying an operation the contract does not
 * declare, would let page script enumerate and invoke arbitrary channels — the
 * exact escape the versioned bridge exists to prevent.
 *
 * Checked against the preload source rather than a running Electron, so it runs
 * in the ordinary suite; the property is structural.
 * @module apps/desktop/tests/preload-surface.test
 */
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { DESKTOP_OPERATIONS } from '../../../packages/desktop-contract/src/index.ts'

const source = readFileSync(fileURLToPath(new URL('../src/preload/index.ts', import.meta.url)), 'utf8')

describe('the exposed surface is closed', () => {
  it('exposes exactly one object, through contextBridge', () => {
    expect([...source.matchAll(/exposeInMainWorld\(/g)]).toHaveLength(1)
  })

  it('freezes what it exposes, so the page cannot graft members onto it', () => {
    expect(source).toMatch(/exposeInMainWorld\([^,]+,\s*Object\.freeze\(/)
  })

  it('never hands the renderer ipcRenderer itself', () => {
    // Exposing it would make every channel reachable and enumerable, which is
    // what the operation allowlist exists to prevent.
    expect(source).not.toMatch(/exposeInMainWorld\([^)]*ipcRenderer[^)]*\)/)
  })

  it('routes every operation through the single declared channel', () => {
    const invocations = [...source.matchAll(/ipcRenderer\.invoke\(([A-Za-z_$][\w$]*)/g)].map((m) => m[1])
    expect(invocations.length).toBeGreaterThan(0)
    expect(new Set(invocations)).toEqual(new Set(['DESKTOP_IPC_CHANNEL']))
  })

  it('implements every declared operation and invents none', () => {
    const sent = new Set([...source.matchAll(/send<[^>]*>\('([a-zA-Z]+)'/g)].map((m) => m[1]!))
    const declared = new Set(DESKTOP_OPERATIONS)
    for (const operation of sent) {
      expect(declared, `preload sends undeclared operation ${operation}`).toContain(operation)
    }
    // `subscribeWindowState` is renderer-local (it registers a listener rather
    // than invoking), so it is the one declared member with no `send`.
    for (const operation of declared) {
      if (operation === 'subscribeWindowState') continue
      expect(sent, `preload never sends declared operation ${operation}`).toContain(operation)
    }
  })

  it('validates each request in the preload, before it reaches the main process', () => {
    for (const parser of ['parsePickDirectoryRequest', 'parseWindowActionRequest', 'parseOpenExternalRequest']) {
      expect(source, `${parser} is not applied in the preload`).toContain(parser)
    }
  })
})
