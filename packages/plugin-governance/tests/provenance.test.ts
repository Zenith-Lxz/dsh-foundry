import { describe, expect, it } from 'vitest'
import {
  FOUNDRY_DISTRIBUTION,
  USER_AUTHORITY_WARNING,
  deriveProvenance,
  describeDisableImpact,
  isFoundryVerified,
  matchesQuery,
  type PluginProvenance,
} from '../src/provenance.ts'

/**
 * Build a row with sane defaults.
 * @param overrides - Fields to override.
 * @returns The row.
 */
function rowOf(overrides: Partial<PluginProvenance> = {}): PluginProvenance {
  return {
    packageName: '@dsh-foundry/daily-agent',
    displayName: 'Daily agent',
    version: '0.1.0',
    source: 'foundry',
    evidence: { field: 'dshFoundry.distribution', value: FOUNDRY_DISTRIBUTION },
    profile: 'desktop',
    bundle: '@dsh-foundry/daily-bundle',
    enabled: true,
    foundryVerified: true,
    disableable: true,
    disableImpact: '',
    ...overrides,
  }
}

describe('provenance comes from declared metadata, never from the name', () => {
  it('recognizes a Foundry package by its declaration', () => {
    const result = deriveProvenance({
      name: '@dsh-foundry/daily-agent',
      dshFoundry: { distribution: FOUNDRY_DISTRIBUTION },
    })
    expect(result.source).toBe('foundry')
    expect(result.evidence?.field).toBe('dshFoundry.distribution')
  })

  it('does not claim a lookalike name as ours', () => {
    // Anyone can publish a package whose name starts with our prefix; only the
    // declaration is evidence.
    const result = deriveProvenance({ name: '@dsh-foundry-tools/whatever' })
    expect(result.source).not.toBe('foundry')
  })

  it('recognizes official packages by publisher scope', () => {
    const result = deriveProvenance({ name: '@deepseek-ai/dsh-web-app' })
    expect(result.source).toBe('official')
  })

  it('never marks an official package as Foundry', () => {
    const result = deriveProvenance({ name: '@deepseek-ai/dsh-web-app' })
    expect(result.source).toBe('official')
    expect(isFoundryVerified({ name: '@deepseek-ai/dsh-web-app' }, result.source)).toBe(false)
  })

  it('classifies a workspace-local package as workspace', () => {
    const result = deriveProvenance({ name: 'my-local-plugin' }, { workspaceLocal: true })
    expect(result.source).toBe('workspace')
  })

  it('classifies a package with an install record as a user plugin', () => {
    const result = deriveProvenance({ name: 'community-thing', installedFrom: 'npm:community-thing' })
    expect(result.source).toBe('user')
  })

  it('reports unknown rather than guessing when nothing declared it', () => {
    const result = deriveProvenance({ name: 'mystery' })
    expect(result.source).toBe('unknown')
    expect(result.evidence).toBeNull()
  })

  it('reports unknown for an empty manifest', () => {
    expect(deriveProvenance({}).source).toBe('unknown')
  })
})

describe('verified is a claim about this distribution’s own testing', () => {
  it('is true only for a qualified Foundry package', () => {
    expect(isFoundryVerified({ dshFoundry: { distribution: FOUNDRY_DISTRIBUTION, qualified: true } }, 'foundry')).toBe(true)
  })

  it('is false for a Foundry package that was not qualified', () => {
    expect(isFoundryVerified({ dshFoundry: { distribution: FOUNDRY_DISTRIBUTION } }, 'foundry')).toBe(false)
  })

  it('refuses a self-declared qualification from a package that is not ours', () => {
    // Otherwise any publisher could mark their own package verified in our view.
    expect(isFoundryVerified({ name: 'x', dshFoundry: { qualified: true } }, 'user')).toBe(false)
  })

  it.each(['official', 'user', 'workspace', 'unknown'] as const)('is false for a %s package', (source) => {
    expect(isFoundryVerified({ dshFoundry: { qualified: true } }, source)).toBe(false)
  })
})

describe('search finds what the official list cannot', () => {
  it('finds Foundry packages by distribution name', () => {
    expect(matchesQuery(rowOf(), 'foundry')).toBe(true)
  })

  it('finds the daily layer by bundle', () => {
    expect(matchesQuery(rowOf(), 'daily')).toBe(true)
  })

  it('finds by source label', () => {
    expect(matchesQuery(rowOf({ source: 'user' }), 'user')).toBe(true)
  })

  it('finds by profile', () => {
    expect(matchesQuery(rowOf(), 'desktop')).toBe(true)
  })

  it('is case-insensitive', () => {
    expect(matchesQuery(rowOf(), 'FOUNDRY')).toBe(true)
  })

  it('returns everything for an empty query', () => {
    expect(matchesQuery(rowOf(), '   ')).toBe(true)
  })

  it('excludes a row that matches nothing', () => {
    expect(matchesQuery(rowOf(), 'postgres')).toBe(false)
  })
})

describe('disable impact says what turning it off costs', () => {
  it('explains why a required official row cannot be disabled', () => {
    const text = describeDisableImpact({ source: 'official', packageName: 'x', disableable: false, bundle: null })
    expect(text).toMatch(/missing service/)
  })

  it('explains a required distribution row separately', () => {
    const text = describeDisableImpact({ source: 'foundry', packageName: 'x', disableable: false, bundle: null })
    expect(text).toMatch(/workbench or desktop shell/)
  })

  it('says official behavior is unchanged when a Foundry extra is removed', () => {
    const text = describeDisableImpact({ source: 'foundry', packageName: 'x', disableable: true, bundle: null })
    expect(text).toMatch(/official behavior unchanged/)
  })
})

describe('the authority warning states what approval does not cover', () => {
  it('names plugin code and MCP servers', () => {
    expect(USER_AUTHORITY_WARNING).toMatch(/plugin code or to MCP servers/)
  })

  it('says this distribution has not reviewed it', () => {
    expect(USER_AUTHORITY_WARNING).toMatch(/has not reviewed it/)
  })
})
