/**
 * The governance panel.
 *
 * The same facts the doctor CLI reports, as a view model: what is installed,
 * where it came from, what authority it holds, and what a lifecycle operation
 * would do.
 *
 * Two things it must never do. It must not present a tier as a safety rating —
 * `core` means this distribution ships it, not that it is harmless. And it must
 * not let an absent finding read as a clean bill: the panel states that it
 * checked composition and not behavior, on every render.
 * @module @dsh-foundry/plugin-governance/view
 */
import { AUTHORITY_WARNING, describeAuthority } from './authority.ts'
import type { CapabilityTier, PackageAuthority } from '@dsh-foundry/daily-contract'
import type { LifecycleOperation } from './lifecycle.ts'

/** One installed package as the panel shows it. */
export interface GovernanceRow {
  readonly packageName: string
  readonly version: string
  readonly tier: CapabilityTier
  /** Granted capabilities, phrased for a reader. */
  readonly grantedAuthority: readonly string[]
  /** Set when authority had to be assumed rather than read. */
  readonly authorityAssumed: boolean
  /** Operations offered for this row. */
  readonly operations: readonly LifecycleOperation[]
}

/** What the governance panel shows. */
export interface GovernanceView {
  readonly profile: string
  readonly bundleLayers: readonly string[]
  readonly rows: readonly GovernanceRow[]
  /** Always present: plugin authority is not the model tool sandbox. */
  readonly authorityWarning: string
  /** Always present: what this panel verified and what it did not. */
  readonly scopeNote: string
  /** What a tier does and does not mean. */
  readonly tierNote: string
}

/** What this panel checked. */
export const GOVERNANCE_SCOPE_NOTE =
  'This panel reports installed composition and declared authority. It does not execute plugin code or observe '
  + 'what it does at run time, so an empty findings list is not a clean bill of health.'

/** What a tier means. */
export const TIER_NOTE =
  'A tier says who vouches for a package, not how dangerous it is: `core` means this distribution ships and '
  + 'qualifies it, `optional-qualified` means it was reviewed against this release, and `community-unreviewed` '
  + 'means neither. Every tier runs with the same user-level process authority.'

/**
 * Operations available for a row.
 *
 * Core packages offer no removal: removing one leaves a profile this
 * distribution cannot qualify, and offering the button implies otherwise.
 * @param tier - The package's tier.
 * @returns Offered operations.
 */
export function operationsFor(tier: CapabilityTier): LifecycleOperation[] {
  return tier === 'core' ? ['update', 'rollback'] : ['disable', 'update', 'rollback', 'remove']
}

/**
 * Build the governance panel.
 * @param input - Profile identity and installed packages.
 * @returns The view model.
 */
export function buildGovernanceView(input: {
  readonly profile: string
  readonly bundleLayers: readonly string[]
  readonly packages: readonly {
    readonly packageName: string
    readonly version: string
    readonly tier: CapabilityTier
    readonly authority: PackageAuthority
    readonly authorityAssumed: boolean
  }[]
}): GovernanceView {
  return {
    profile: input.profile,
    bundleLayers: input.bundleLayers,
    rows: input.packages.map((entry): GovernanceRow => ({
      packageName: entry.packageName,
      version: entry.version,
      tier: entry.tier,
      grantedAuthority: describeAuthority(entry.authority)
        .filter((line) => line.granted)
        .map((line) => `${line.capability}: ${line.meaning}`),
      authorityAssumed: entry.authorityAssumed,
      operations: operationsFor(entry.tier),
    })),
    authorityWarning: AUTHORITY_WARNING,
    scopeNote: GOVERNANCE_SCOPE_NOTE,
    tierNote: TIER_NOTE,
  }
}
