import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { REQUIRED_FOUNDRY_PACKAGES, inventoryHome, inventoryProfile, summarize } from '../src/inventory.ts'

/**
 * Build a profile directory holding the given packages.
 * @param packages - Package name to its manifest.
 * @param bundles - Bundle layers the profile declares.
 * @returns The profile directory.
 */
function profileWith(
  packages: Record<string, Record<string, unknown>>,
  bundles: readonly string[] = [],
): string {
  const dir = mkdtempSync(join(tmpdir(), 'inventory-'))
  mkdirSync(join(dir, 'node_modules'), { recursive: true })
  const dependencies: Record<string, string> = {}
  for (const [name, manifest] of Object.entries(packages)) {
    dependencies[name] = '0.1.0'
    const packageDir = join(dir, 'node_modules', ...name.split('/'))
    mkdirSync(packageDir, { recursive: true })
    writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest))
  }
  writeFileSync(
    join(dir, 'package.json'),
    JSON.stringify({ dependencies, dsh: { profile: { bundles } } }),
  )
  return dir
}

const FOUNDRY = { distribution: 'dsh-foundry', qualified: true }

describe('the inventory finds what the official list cannot', () => {
  it('lists a Foundry package the runtime carries no provenance for', () => {
    const dir = profileWith({
      '@dsh-foundry/daily-agent': { name: '@dsh-foundry/daily-agent', version: '0.1.0', dshFoundry: FOUNDRY },
    })
    const entries = inventoryProfile(dir, 'desktop').entries
    expect(entries).toHaveLength(1)
    expect(entries[0]?.source).toBe('foundry')
    expect(entries[0]?.foundryVerified).toBe(true)
  })

  it('does not mark an official package as Foundry', () => {
    const dir = profileWith({
      '@deepseek-ai/dsh-web-app': { name: '@deepseek-ai/dsh-web-app', version: '0.1.0' },
    })
    const entry = inventoryProfile(dir, 'desktop').entries[0]!
    expect(entry.source).toBe('official')
    expect(entry.foundryVerified).toBe(false)
  })

  it('reports unknown for a package with no declaring metadata', () => {
    const dir = profileWith({ mystery: { name: 'mystery', version: '2.0.0' } })
    const entry = inventoryProfile(dir, 'desktop').entries[0]!
    expect(entry.source).toBe('unknown')
    expect(entry.evidence).toBeNull()
  })

  it('reports an unreadable manifest as unknown with an unknown version', () => {
    const dir = profileWith({})
    writeFileSync(join(dir, 'package.json'), JSON.stringify({ dependencies: { ghost: '1.0.0' } }))
    const entry = inventoryProfile(dir, 'desktop').entries[0]!
    expect(entry.source).toBe('unknown')
    // Printing the requested range here would show a constraint as a fact.
    expect(entry.version).toBe('unknown')
  })

  it('returns nothing for a profile with no manifest', () => {
    expect(inventoryProfile(join(tmpdir(), 'no-such-profile'), 'x').entries).toEqual([])
  })
})

describe('required packages are listed, not inferred', () => {
  it('marks a required Foundry package as not disableable', () => {
    const name = REQUIRED_FOUNDRY_PACKAGES[0]!
    const dir = profileWith({ [name]: { name, version: '0.1.0', dshFoundry: FOUNDRY } })
    expect(inventoryProfile(dir, 'desktop').entries[0]?.disableable).toBe(false)
  })

  it('marks an optional Foundry package as disableable and says what is lost', () => {
    const dir = profileWith({
      '@dsh-foundry/daily-agent': { name: '@dsh-foundry/daily-agent', version: '0.1.0', dshFoundry: FOUNDRY },
    })
    const entry = inventoryProfile(dir, 'desktop').entries[0]!
    expect(entry.disableable).toBe(true)
    expect(entry.disableImpact).toMatch(/official behavior unchanged/)
  })

  it('never offers to disable an official package', () => {
    const dir = profileWith({ '@deepseek-ai/dsh-web-app': { name: '@deepseek-ai/dsh-web-app', version: '0.1.0' } })
    expect(inventoryProfile(dir, 'desktop').entries[0]?.disableable).toBe(false)
  })
})

describe('the summary counts what a reader has to weigh', () => {
  it('counts unreviewed packages, which is the set the authority warning covers', () => {
    const entries = [
      { source: 'official', foundryVerified: false },
      { source: 'foundry', foundryVerified: true },
      { source: 'user', foundryVerified: false },
      { source: 'unknown', foundryVerified: false },
    ] as never
    const result = summarize(entries)
    expect(result.total).toBe(4)
    expect(result.official).toBe(1)
    expect(result.foundry).toBe(1)
    expect(result.unknown).toBe(1)
    // Official packages are not ours to review, so they are excluded; the two
    // remaining are what runs with the user's authority unvouched for.
    expect(result.unreviewed).toBe(2)
  })

  it('counts nothing for an empty inventory', () => {
    expect(summarize([])).toMatchObject({ total: 0, unreviewed: 0 })
  })
})

describe('a home is walked profile by profile', () => {
  it('returns nothing when the home has no profiles directory', () => {
    expect(inventoryHome(mkdtempSync(join(tmpdir(), 'empty-home-')))).toEqual([])
  })
})
