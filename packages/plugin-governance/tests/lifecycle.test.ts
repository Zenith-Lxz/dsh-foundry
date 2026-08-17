import { describe, expect, it } from 'vitest'
import {
  REQUIRED_FORM,
  classifySource,
  planRemoval,
  renderPlan,
  type PackageFootprint,
} from '../src/lifecycle.ts'

/**
 * Build a footprint.
 * @param overrides - Fields to override.
 * @returns The footprint.
 */
function footprintOf(overrides: Partial<PackageFootprint> = {}): PackageFootprint {
  return {
    packageName: '@vendor/thing',
    version: '1.2.0',
    reversibleRegistrations: ['tool: vendor_search', 'slot: conversation.details.tool'],
    ownedDataPaths: [],
    dependents: [],
    previousVersion: null,
    ...overrides,
  }
}

describe('published packages are the only accepted install form', () => {
  it.each([
    '@deepseek-ai/dsh-web-app',
    'some-plugin',
    '@scope/plugin@1.2.3',
    '@scope/plugin@^1.0.0',
  ])('accepts the registry spec %s', (source) => {
    expect(classifySource(source).accepted).toBe(true)
  })

  it('accepts a tarball URL, which still carries a fixed version', () => {
    const verdict = classifySource('https://example.invalid/pkg-1.0.0.tgz')
    expect(verdict).toMatchObject({ accepted: true, kind: 'tarball-url' })
  })
})

describe('a legacy .dsh-plugin repository is refused with a reason', () => {
  it.each([
    'https://github.com/someone/thing.dsh-plugin',
    'dsh-plugin:someone/thing',
    '/Users/me/things/x.dsh-plugin/',
  ])('refuses %s', (source) => {
    const verdict = classifySource(source)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.kind).toBe('legacy-dsh-plugin')
  })

  it('names a second installer as the reason, not a preference', () => {
    const verdict = classifySource('https://github.com/someone/thing.dsh-plugin')
    if (!verdict.accepted) {
      expect(verdict.reason).toMatch(/second plugin installer/)
      expect(verdict.remedy).toMatch(/Two installers disagreeing/)
    }
  })

  it('tells the user what form would work', () => {
    const verdict = classifySource('dsh-plugin:someone/thing')
    if (!verdict.accepted) expect(verdict.remedy).toContain(REQUIRED_FORM)
  })
})

describe('sources with no recorded version are refused', () => {
  it.each([
    'git+https://github.com/someone/thing.git',
    'git@github.com:someone/thing.git',
    'https://github.com/someone/thing.git',
  ])('refuses the git source %s', (source) => {
    const verdict = classifySource(source)
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.kind).toBe('git')
  })

  it.each(['./local/thing', '../thing', '/abs/thing', 'file:../thing'])(
    'refuses the local path %s',
    (source) => {
      const verdict = classifySource(source)
      expect(verdict.accepted).toBe(false)
      if (!verdict.accepted) expect(verdict.kind).toBe('local-path')
    },
  )

  it('says a local path binds the profile to one machine', () => {
    const verdict = classifySource('./thing')
    if (!verdict.accepted) expect(verdict.reason).toMatch(/one machine/)
  })

  it('refuses something it does not recognize rather than trying it', () => {
    const verdict = classifySource('!! not a spec !!')
    expect(verdict.accepted).toBe(false)
    if (!verdict.accepted) expect(verdict.kind).toBe('unknown')
  })
})

describe('lifecycle plans withdraw registrations and keep data', () => {
  it('lists what the runtime withdraws automatically', () => {
    const plan = planRemoval('remove', footprintOf())
    expect(plan.withdrawn).toEqual(['tool: vendor_search', 'slot: conversation.details.tool'])
  })

  it('retains plugin-owned data rather than deleting it', () => {
    // An unwanted file is recoverable; a deleted one is not.
    const plan = planRemoval('remove', footprintOf({ ownedDataPaths: ['~/.dsh/vendor/cache.db'] }))
    expect(plan.retainedData).toEqual(['~/.dsh/vendor/cache.db'])
    expect(plan.notes.join()).toMatch(/left in place|Delete them yourself/)
  })

  it('says unrelated composition is untouched on update', () => {
    const plan = planRemoval('update', footprintOf())
    expect(plan.notes.join()).toMatch(/Composition outside this package is untouched/)
  })

  it('says a disabled package stays installed', () => {
    expect(planRemoval('disable', footprintOf()).notes.join()).toMatch(/can be re-enabled/)
  })
})

describe('an operation that would break the profile is blocked, not attempted', () => {
  it('blocks removal while a dependent declares the package', () => {
    const plan = planRemoval('remove', footprintOf({ dependents: ['@vendor/suite'] }))
    expect(plan.blocked).toMatch(/@vendor\/suite/)
  })

  it('withdraws nothing when blocked, so the report cannot imply a partial removal', () => {
    const plan = planRemoval('remove', footprintOf({ dependents: ['@vendor/suite'] }))
    expect(plan.withdrawn).toEqual([])
  })

  it('blocks disable for the same reason', () => {
    expect(planRemoval('disable', footprintOf({ dependents: ['@vendor/suite'] })).blocked).not.toBeNull()
  })

  it('allows an update even with dependents, which keeps the row present', () => {
    expect(planRemoval('update', footprintOf({ dependents: ['@vendor/suite'] })).blocked).toBeNull()
  })

  it('blocks a rollback with no recorded previous version', () => {
    const plan = planRemoval('rollback', footprintOf({ previousVersion: null }))
    expect(plan.blocked).toMatch(/nothing to roll back to/)
  })

  it('allows a rollback when a previous version is recorded', () => {
    expect(planRemoval('rollback', footprintOf({ previousVersion: '1.1.0' })).blocked).toBeNull()
  })
})

describe('a plan reads as a confirmation prompt', () => {
  it('renders BLOCKED first when blocked', () => {
    const lines = renderPlan(planRemoval('remove', footprintOf({ dependents: ['@vendor/suite'] })))
    expect(lines[0]).toMatch(/BLOCKED/)
  })

  it('separates withdrawn registrations from retained data', () => {
    const text = renderPlan(planRemoval('remove', footprintOf({ ownedDataPaths: ['~/.dsh/x'] }))).join('\n')
    expect(text).toMatch(/withdrawn automatically:/)
    expect(text).toMatch(/left in place \(not deleted\):/)
  })

  it('says nothing about data when the package left none', () => {
    expect(renderPlan(planRemoval('remove', footprintOf())).join('\n')).not.toMatch(/left in place/)
  })
})
