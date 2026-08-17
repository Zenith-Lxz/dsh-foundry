import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  BROWSER_AFFORDANCES,
  MOUNT_PLAN,
  OFFICIAL_SLOT_KINDS,
  WORKBENCH_SLOTS,
  resolveAffordances,
  unsatisfiablePanels,
} from '../src/client/mount.ts'
import { apply } from '../src/client/plugin.tsx'

/** Slots verified to exist in the pinned DSH build by `probe:contracts`. */
const OFFICIAL_SLOTS = [
  'root', 'sidebar', 'conversation', 'details', 'shell.overlay',
  'conversation.input.overlay', 'conversation.input.dock',
  'conversation.session.header.utilities', 'conversation.view', 'conversation.input.dock',
  'sidebar.footer.action', 'conversation.hero.workspace.directoryFlow',
  'sidebar.workspaces.directoryFlow',
]

describe('panels only occupy additive slots', () => {
  it('never targets a single-kind slot', () => {
    // A single slot has one occupant, so registering into it replaces what the
    // official product put there. `conversation.details.tool` states in its own
    // contract that taking it means rendering every tool's output — an additive
    // workbench must never sit in a seat like that.
    for (const panel of MOUNT_PLAN) {
      const kind = OFFICIAL_SLOT_KINDS[panel.slot as keyof typeof OFFICIAL_SLOT_KINDS]
      expect(kind, `${panel.id} targets ${panel.slot}`).toBe('list')
    }
  })

  it('records conversation.details.tool as single, so the plan cannot drift back onto it', () => {
    expect(OFFICIAL_SLOT_KINDS['conversation.details.tool']).toBe('single')
  })
})

describe('every panel occupies a slot the official build declares', () => {
  it('names only public slots', () => {
    expect(unsatisfiablePanels(OFFICIAL_SLOTS)).toEqual([])
  })

  it('fails loudly when a slot is renamed upstream', () => {
    // A panel whose slot vanished must fail at load, not render nowhere.
    const without = OFFICIAL_SLOTS.filter((slot) => slot !== WORKBENCH_SLOTS.panels)
    expect(unsatisfiablePanels(without).length).toBeGreaterThan(0)
  })

  it('gives every panel a distinct id, so registration cannot collide', () => {
    expect(new Set(MOUNT_PLAN.map((panel) => panel.id)).size).toBe(MOUNT_PLAN.length)
  })

  it('covers review, verification, context, jobs, subagents, attention, and search', () => {
    expect(MOUNT_PLAN.map((panel) => panel.id).sort()).toEqual(
      ['attention', 'context', 'jobs', 'review', 'search', 'subagents', 'toggle', 'verification'],
    )
  })
})

describe('the browser is the baseline, not a degraded host', () => {
  it('marks every panel browser-capable', () => {
    // A false here would mean the workbench grew a desktop-only capability.
    expect(MOUNT_PLAN.every((panel) => panel.browserCapable)).toBe(true)
  })

  it('falls back to browser affordances when no shell is hosting', () => {
    expect(resolveAffordances(undefined)).toEqual(BROWSER_AFFORDANCES)
  })

  it('takes the shell affordances when one is hosting', () => {
    const shell = { nativeDirectoryPicker: true, reservedTitleBarHeight: 38 }
    expect(resolveAffordances(shell)).toEqual(shell)
  })

  it('offers no native picker in a plain browser', () => {
    expect(BROWSER_AFFORDANCES.nativeDirectoryPicker).toBe(false)
  })
})

describe('no workbench module reaches for the desktop bridge', () => {
  const sourceDir = join(import.meta.dirname, '../src')

  /**
   * Every TypeScript source under the workbench.
   * @param dir - Directory to walk.
   * @returns Absolute file paths.
   */
  function sources(dir: string): string[] {
    return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
      const path = join(dir, entry.name)
      if (entry.isDirectory()) return sources(path)
      return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
    })
  }

  it.each(sources(sourceDir).map((path) => [path.slice(sourceDir.length + 1), path] as const))(
    '%s imports no desktop contract',
    (_name, path) => {
      // Duplicated from gate:coupling deliberately: this fails during ordinary
      // test runs, where the gate only runs as its own step.
      const text = readFileSync(path, 'utf8')
      expect(text).not.toMatch(/from\s+['"]@dsh-desktop\/desktop-contract['"]/)
      expect(text).not.toMatch(/window\.__DESKTOP_BRIDGE__|invokeDesktop/)
    },
  )

  it('documents that workbench data travels the official Remote', () => {
    const text = readFileSync(join(sourceDir, 'client/mount.ts'), 'utf8')
    expect(text).toMatch(/official Typert Remote over HTTP/)
  })
})

describe('the registered @ source is complete enough to send with', () => {
  /**
   * Run the client plugin against a recording context and capture what it
   * registers.
   *
   * The source object is the contract with the official pipeline, and three of
   * its obligations are invisible to a type check: a reference source must
   * supply a codec, must answer the `@` trigger, and must name a menu group.
   * Each was violated at some point, and each showed up only in the browser.
   * @returns The registered trigger source.
   */
  function registeredSource(): Record<string, unknown> {
    // The plugin's first effect installs its stylesheet. A minimal document
    // stub keeps this a test of the registration rather than of the DOM.
    const style: Record<string, unknown> = {}
    const documentStub = {
      getElementById: () => null,
      createElement: () => style,
      head: { append: () => undefined },
    }
    Reflect.set(globalThis, 'document', documentStub)

    let captured: Record<string, unknown> | undefined
    const ctx = {
      effect: (run: () => unknown) => { void run() },
      inject: () => undefined,
      remote: { $mount: () => new Promise<never>(() => undefined) },
      inputTriggers: {
        registerSource: (source: Record<string, unknown>) => {
          captured = source
          return () => undefined
        },
      },
      slots: { register: () => () => undefined },
    }
    try {
      apply(ctx as never)
    } finally {
      Reflect.deleteProperty(globalThis, 'document')
    }
    if (captured === undefined) throw new Error('the plugin registered no trigger source')
    return captured
  }

  it('registers one source on the official @ trigger', () => {
    const source = registeredSource()
    expect(source['trigger']).toBe('@')
    expect(source['name']).toBe('files')
  })

  it('carries a codec, since its picks insert references', () => {
    // Without it the submit attempt rejects with `no serializer for reference
    // source "files"` and the composed message can never be sent.
    const source = registeredSource()
    expect(source['codec']).toBeDefined()
    const codec = source['codec'] as { serialize?: unknown, clipboardText?: unknown }
    expect(typeof codec.serialize).toBe('function')
    expect(typeof codec.clipboardText).toBe('function')
  })

  it('supplies the lexicon hooks that make it a participating reference source', () => {
    const source = registeredSource()
    expect(typeof source['lexicon']).toBe('function')
    expect(typeof source['warm']).toBe('function')
  })
})
