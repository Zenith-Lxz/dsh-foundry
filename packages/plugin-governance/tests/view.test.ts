import { describe, expect, it } from 'vitest'
import { UNKNOWN_AUTHORITY } from '../src/authority.ts'
import {
  GOVERNANCE_SCOPE_NOTE,
  TIER_NOTE,
  buildGovernanceView,
  operationsFor,
} from '../src/view.ts'
import type { PackageAuthority } from '@dsh-foundry/daily-contract'

const NO_AUTHORITY: PackageAuthority = {
  hostProcess: false,
  filesystem: false,
  network: false,
  clientSurface: false,
  installScripts: false,
}

/**
 * Build panel input for one package.
 * @param overrides - Fields to override.
 * @returns The input.
 */
function inputWith(overrides: {
  tier?: 'core' | 'optional-qualified' | 'community-unreviewed'
  authority?: PackageAuthority
  authorityAssumed?: boolean
} = {}) {
  return {
    profile: 'desktop',
    bundleLayers: ['@deepseek-ai/dsh-base', '@dsh-foundry/bundle'],
    packages: [{
      packageName: '@vendor/thing',
      version: '1.0.0',
      tier: overrides.tier ?? 'community-unreviewed',
      authority: overrides.authority ?? NO_AUTHORITY,
      authorityAssumed: overrides.authorityAssumed ?? false,
    }],
  } as const
}

describe('the panel states what it checked and what it did not', () => {
  it('says it checked composition and not behavior', () => {
    // An empty findings list otherwise reads as "everything was verified".
    expect(buildGovernanceView(inputWith()).scopeNote).toBe(GOVERNANCE_SCOPE_NOTE)
    expect(GOVERNANCE_SCOPE_NOTE).toMatch(/not a clean bill of health/)
  })

  it('carries the plugin authority warning on every render', () => {
    expect(buildGovernanceView(inputWith()).authorityWarning).toMatch(/do not apply to plugin code/)
  })

  it('says a tier is not a safety rating', () => {
    expect(buildGovernanceView(inputWith()).tierNote).toBe(TIER_NOTE)
    expect(TIER_NOTE).toMatch(/not how dangerous it is/)
    expect(TIER_NOTE).toMatch(/same user-level process authority/)
  })

  it('shows the bundle layers in order', () => {
    expect(buildGovernanceView(inputWith()).bundleLayers).toEqual([
      '@deepseek-ai/dsh-base', '@dsh-foundry/bundle',
    ])
  })
})

describe('granted authority is listed, ungranted is not', () => {
  it('lists nothing for a package that holds nothing', () => {
    expect(buildGovernanceView(inputWith()).rows[0]!.grantedAuthority).toEqual([])
  })

  it('lists every capability an unknown package must be assumed to hold', () => {
    const view = buildGovernanceView(inputWith({ authority: UNKNOWN_AUTHORITY }))
    expect(view.rows[0]!.grantedAuthority.length).toBeGreaterThanOrEqual(4)
  })

  it('marks authority that was assumed rather than read', () => {
    expect(buildGovernanceView(inputWith({ authorityAssumed: true })).rows[0]!.authorityAssumed).toBe(true)
  })
})

describe('core packages offer no removal', () => {
  it('offers update and rollback only', () => {
    // Removing a core row leaves a profile this distribution cannot qualify.
    expect(operationsFor('core')).toEqual(['update', 'rollback'])
  })

  it.each(['optional-qualified', 'community-unreviewed'] as const)(
    'offers the full set for a %s package',
    (tier) => {
      expect(operationsFor(tier)).toContain('remove')
      expect(operationsFor(tier)).toContain('disable')
    },
  )

  it('carries the operations onto the row', () => {
    const view = buildGovernanceView(inputWith({ tier: 'core' }))
    expect(view.rows[0]!.operations).not.toContain('remove')
  })
})
