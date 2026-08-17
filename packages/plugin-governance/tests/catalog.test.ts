import { describe, expect, it } from 'vitest'
import { UNKNOWN_AUTHORITY } from '../src/authority.ts'
import {
  PRE_INSTALL_WARNING,
  compareAuthority,
  discloseBeforeInstall,
  orderCatalog,
  toCatalogEntry,
  type RegistryMetadata,
} from '../src/catalog.ts'
import type { PackageAuthority } from '@dsh-foundry/daily-contract'

const NONE: PackageAuthority = {
  hostProcess: false,
  filesystem: false,
  network: false,
  clientSurface: false,
  installScripts: false,
}

/**
 * Build registry metadata.
 * @param overrides - Fields to override.
 * @returns The metadata.
 */
function metaOf(overrides: Partial<RegistryMetadata> = {}): RegistryMetadata {
  return { name: '@vendor/thing', version: '1.0.0', dsh: {}, ...overrides }
}

describe('a listing that cannot be read assumes the most, not the least', () => {
  it('assumes every capability when no declaration was published', () => {
    // Assuming no authority would under-report exactly the packages least is
    // known about.
    const entry = toCatalogEntry({ name: '@vendor/opaque', version: '1.0.0' })
    expect(entry.authority).toEqual(UNKNOWN_AUTHORITY)
    expect(entry.authorityAssumed).toBe(true)
  })

  it('reads a real declaration when one exists', () => {
    const entry = toCatalogEntry(metaOf({ dsh: { bundle: { patch: [] } } }))
    expect(entry.authorityAssumed).toBe(false)
    expect(entry.authority.hostProcess).toBe(true)
  })

  it('says so in the disclosure rather than only in a field', () => {
    const disclosure = discloseBeforeInstall(toCatalogEntry({ name: '@vendor/opaque', version: '1.0.0' }))
    expect(disclosure.provisionalNote).toMatch(/every capability is assumed granted/)
  })
})

describe('tiers come from who vouches, never from popularity', () => {
  it('labels a shipped package core', () => {
    expect(toCatalogEntry(metaOf(), ['@vendor/thing']).tier).toBe('core')
  })

  it('labels a reviewed package optional-qualified', () => {
    expect(toCatalogEntry(metaOf(), [], ['@vendor/thing']).tier).toBe('optional-qualified')
  })

  it('labels everything else community-unreviewed', () => {
    expect(toCatalogEntry(metaOf()).tier).toBe('community-unreviewed')
  })

  it('never lifts a popular unreviewed package above a qualified one', () => {
    const ordered = orderCatalog([
      toCatalogEntry(metaOf({ name: '@vendor/popular', downloads: 900_000 })),
      toCatalogEntry(metaOf({ name: '@vendor/reviewed', downloads: 12 }), [], ['@vendor/reviewed']),
    ])
    expect(ordered[0]!.packageName).toBe('@vendor/reviewed')
  })

  it('orders by downloads inside a tier', () => {
    const ordered = orderCatalog([
      toCatalogEntry(metaOf({ name: '@vendor/b', downloads: 10 })),
      toCatalogEntry(metaOf({ name: '@vendor/a', downloads: 500 })),
    ])
    expect(ordered[0]!.packageName).toBe('@vendor/a')
  })
})

describe('authority is disclosed before the click, not after', () => {
  it('carries the warning on every disclosure', () => {
    const disclosure = discloseBeforeInstall(toCatalogEntry(metaOf()))
    expect(disclosure.warning).toBe(PRE_INSTALL_WARNING)
    expect(PRE_INSTALL_WARNING).toMatch(/do not apply to it/)
  })

  it('lists the capabilities being granted', () => {
    const disclosure = discloseBeforeInstall(toCatalogEntry(metaOf({ dsh: { bundle: { patch: [] } } })))
    expect(disclosure.granting.join()).toMatch(/host process/i)
  })

  it('requires confirmation for an unreviewed package', () => {
    expect(discloseBeforeInstall(toCatalogEntry(metaOf())).requiresConfirmation).toBe(true)
  })

  it('requires confirmation for a qualified package too', () => {
    expect(discloseBeforeInstall(toCatalogEntry(metaOf(), [], ['@vendor/thing'])).requiresConfirmation).toBe(true)
  })

  it('skips confirmation only for core, so the real prompt is not trained away', () => {
    expect(discloseBeforeInstall(toCatalogEntry(metaOf(), ['@vendor/thing'])).requiresConfirmation).toBe(false)
  })

  it('states that registry-derived authority is provisional', () => {
    expect(discloseBeforeInstall(toCatalogEntry(metaOf())).provisionalNote).toMatch(/may declare more/)
  })
})

describe('a package that gained authority after install is surfaced', () => {
  it('reports nothing when the install matches the listing', () => {
    const change = compareAuthority(NONE, NONE)
    expect(change.asDisclosed).toBe(true)
    expect(change.advice).toBeNull()
  })

  it('names capabilities the installed package added', () => {
    const change = compareAuthority(NONE, { ...NONE, hostProcess: true, network: true })
    expect(change.asDisclosed).toBe(false)
    expect(change.widened).toHaveLength(2)
    expect(change.advice).toMatch(/described something narrower/)
  })

  it('does not report a narrowing as a problem', () => {
    // Holding less than disclosed is fine; only widening breaks the approval.
    const change = compareAuthority({ ...NONE, network: true }, NONE)
    expect(change.asDisclosed).toBe(true)
  })
})
