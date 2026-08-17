import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { harnessHome, listProfiles, runDoctor } from '../src/cli.ts'

const homes: string[] = []

/**
 * Build a Harness home containing the given profiles.
 * @param profiles - Profile name to the packages installed in it.
 * @returns The home path.
 */
function homeWith(profiles: Record<string, Record<string, unknown>>): string {
  const home = mkdtempSync(join(tmpdir(), 'doctor-'))
  homes.push(home)
  for (const [profile, packages] of Object.entries(profiles)) {
    const profileDir = join(home, 'profiles', profile)
    mkdirSync(join(profileDir, 'node_modules'), { recursive: true })
    const dependencies: Record<string, string> = {}
    for (const [name, manifest] of Object.entries(packages)) {
      dependencies[name] = '0.1.0'
      const packageDir = join(profileDir, 'node_modules', name)
      mkdirSync(packageDir, { recursive: true })
      writeFileSync(join(packageDir, 'package.json'), JSON.stringify(manifest))
    }
    writeFileSync(
      join(profileDir, 'package.json'),
      JSON.stringify({ name: `dsh-profile-${profile}`, dependencies }),
    )
  }
  return home
}

afterEach(() => {
  delete process.env['DSH_HOME']
})

describe('the Harness home comes from the runtime, not a guess', () => {
  it('honours DSH_HOME when set', () => {
    process.env['DSH_HOME'] = '/somewhere/else'
    expect(harnessHome()).toBe('/somewhere/else')
  })

  it('falls back to the default location when the variable is empty', () => {
    process.env['DSH_HOME'] = ''
    expect(harnessHome()).toMatch(/\.dsh$/)
  })
})

describe('profile discovery reads the real directory', () => {
  it('lists profiles in sorted order', () => {
    const home = homeWith({ desktop: {}, daily: {} })
    expect(listProfiles(home)).toEqual(['daily', 'desktop'])
  })

  it('returns nothing for a home that does not exist', () => {
    expect(listProfiles(join(tmpdir(), 'no-such-home-xyz'))).toEqual([])
  })

  it('skips the hoisted node_modules directory, which is not a profile', () => {
    const home = homeWith({ desktop: {} })
    mkdirSync(join(home, 'profiles', 'node_modules'), { recursive: true })
    expect(listProfiles(home)).toEqual(['desktop'])
  })
})

describe('the report tells the user what to do when nothing is installed', () => {
  it('names the official install command rather than only reporting emptiness', () => {
    const result = runDoctor({ home: mkdtempSync(join(tmpdir(), 'empty-')) })
    expect(result.healthy).toBe(false)
    expect(result.report).toContain('dsh plugin --profile')
  })
})

describe('the report discloses authority for packages the user chose', () => {
  it('lists granted authority for a non-core package', () => {
    const home = homeWith({
      desktop: {
        '@vendor/thing': { name: '@vendor/thing', version: '0.1.0', dsh: { bundle: { patch: [] } } },
      },
    })
    const report = runDoctor({ home }).report
    expect(report).toContain('authority — @vendor/thing')
    expect(report).toMatch(/host process/i)
  })

  it('stays quiet about core packages, whose authority the distribution already owns', () => {
    const home = homeWith({
      desktop: { '@dsh-foundry/bundle': { name: '@dsh-foundry/bundle', version: '0.1.0' } },
    })
    const report = runDoctor({ home, tiers: { corePackages: ['@dsh-foundry/bundle'] } }).report
    expect(report).not.toContain('authority — @dsh-foundry/bundle')
  })

  it('marks authority as assumed when the manifest cannot be read', () => {
    const home = homeWith({ desktop: {} })
    // A dependency declared by the profile but absent from node_modules is
    // exactly the case where guessing "no authority" would be the dangerous answer.
    writeFileSync(
      join(home, 'profiles', 'desktop', 'package.json'),
      JSON.stringify({ name: 'dsh-profile-desktop', dependencies: { '@vendor/ghost': '1.0.0' } }),
    )
    expect(runDoctor({ home }).report).toContain('(assumed: manifest unreadable)')
  })
})

describe('the report states its own limits', () => {
  it('carries the plugin authority warning', () => {
    const report = runDoctor({ home: homeWith({ desktop: {} }) }).report
    expect(report).toMatch(/do not apply to plugin code or to MCP servers/)
  })

  it('says it checked composition and not behavior, so no finding is not a clean bill', () => {
    const report = runDoctor({ home: homeWith({ desktop: {} }) }).report
    expect(report).toMatch(/composition, not behavior/)
  })
})

describe('a single profile can be inspected on its own', () => {
  it('reports only the requested profile', () => {
    const home = homeWith({ desktop: {}, daily: {} })
    const result = runDoctor({ home, profile: 'daily' })
    expect(result.profiles).toEqual(['daily'])
    expect(result.report).not.toContain('profile: desktop')
  })
})
