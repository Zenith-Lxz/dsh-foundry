/**
 * Plugin discovery, with authority disclosed before installation.
 *
 * A marketplace that shows a description and an install button teaches the user
 * that installing is a small decision. It is not: a Host plugin runs with the
 * user's own process authority, and no model-tool approval applies to it. This
 * module exists so the disclosure arrives **before** the click rather than in a
 * doctor report afterwards.
 *
 * The honest limit is stated rather than hidden. Authority derived from
 * registry metadata is **provisional**: the published tarball is what actually
 * runs, and it can declare more than the packument suggested. Every provisional
 * finding is labelled as such and re-derived from the installed package, and a
 * widened authority is surfaced as a change the user has to acknowledge.
 * @module @dsh-foundry/plugin-governance/catalog
 */
import { UNKNOWN_AUTHORITY, describeAuthority, deriveAuthority } from './authority.ts'
import type { CapabilityTier, PackageAuthority } from '@dsh-foundry/daily-contract'
import type { PackageManifest } from './authority.ts'

/** Registry metadata this module reads. Everything is optional by nature. */
export interface RegistryMetadata {
  readonly name: string
  readonly version: string
  readonly description?: string
  readonly dsh?: PackageManifest['dsh']
  readonly scripts?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  /** Weekly downloads, when the registry reports them. */
  readonly downloads?: number
  /** ISO timestamp of the last publish, when reported. */
  readonly publishedAt?: string
}

/** One catalog entry as the discovery surface shows it. */
export interface CatalogEntry {
  readonly packageName: string
  readonly version: string
  readonly description: string
  readonly tier: CapabilityTier
  /** Authority the metadata implies. Provisional until installed. */
  readonly authority: PackageAuthority
  /**
   * True when authority could not be read and the safe assumption was used.
   *
   * Assuming *no* authority for unreadable metadata under-reports exactly the
   * packages least is known about, so the assumption runs the other way.
   */
  readonly authorityAssumed: boolean
  readonly downloads: number | null
  readonly publishedAt: string | null
}

/** What the user is told before installing. */
export interface PreInstallDisclosure {
  readonly packageName: string
  readonly version: string
  readonly tier: CapabilityTier
  /** Capabilities being granted, phrased for a reader. */
  readonly granting: readonly string[]
  /** Always present. */
  readonly warning: string
  /** What this disclosure cannot promise. */
  readonly provisionalNote: string
  /** True when installing requires an explicit confirmation step. */
  readonly requiresConfirmation: boolean
}

/** The sentence every disclosure carries. */
export const PRE_INSTALL_WARNING =
  'Installing runs this package with your user authority every time the Harness starts. '
  + 'The approval prompts you see for model tool calls do not apply to it.'

/** What registry-derived authority cannot promise. */
export const PROVISIONAL_NOTE =
  'Derived from registry metadata. The published package is what actually runs and may declare more; '
  + 'authority is re-checked after installation and any widening is reported.'

/**
 * Build a catalog entry from registry metadata.
 * @param metadata - What the registry reported.
 * @param corePackages - Packages this distribution ships and qualifies.
 * @param qualifiedPackages - Packages reviewed against this release.
 * @returns The entry.
 */
export function toCatalogEntry(
  metadata: RegistryMetadata,
  corePackages: readonly string[] = [],
  qualifiedPackages: readonly string[] = [],
): CatalogEntry {
  const readable = metadata.dsh !== undefined || metadata.scripts !== undefined
  return {
    packageName: metadata.name,
    version: metadata.version,
    description: metadata.description ?? '(no description published)',
    tier: corePackages.includes(metadata.name)
      ? 'core'
      : qualifiedPackages.includes(metadata.name)
        ? 'optional-qualified'
        : 'community-unreviewed',
    authority: readable ? deriveAuthority(toManifest(metadata), {}) : UNKNOWN_AUTHORITY,
    authorityAssumed: !readable,
    downloads: metadata.downloads ?? null,
    publishedAt: metadata.publishedAt ?? null,
  }
}

/**
 * Narrow registry metadata to the manifest fields authority derivation reads.
 *
 * Absent fields are omitted rather than passed as `undefined`, so a registry
 * that simply did not report a field is not mistaken for one that reported it
 * empty.
 * @param metadata - What the registry reported.
 * @returns A manifest carrying only the fields that were present.
 */
function toManifest(metadata: RegistryMetadata): PackageManifest {
  return {
    name: metadata.name,
    ...(metadata.dsh === undefined ? {} : { dsh: metadata.dsh }),
    ...(metadata.scripts === undefined ? {} : { scripts: metadata.scripts }),
    ...(metadata.dependencies === undefined ? {} : { dependencies: metadata.dependencies }),
  }
}

/**
 * Build the disclosure shown before an install is confirmed.
 *
 * Confirmation is required for everything except `core`, because `core` is what
 * this distribution already ships and qualifies — asking about it would train
 * the user to click through the prompt that matters.
 * @param entry - The catalog entry.
 * @returns The disclosure.
 */
export function discloseBeforeInstall(entry: CatalogEntry): PreInstallDisclosure {
  return {
    packageName: entry.packageName,
    version: entry.version,
    tier: entry.tier,
    granting: describeAuthority(entry.authority)
      .filter((line) => line.granted)
      .map((line) => `${line.capability}: ${line.meaning}`),
    warning: PRE_INSTALL_WARNING,
    provisionalNote: entry.authorityAssumed
      ? `${PROVISIONAL_NOTE} This package published no readable declaration, so every capability is assumed granted.`
      : PROVISIONAL_NOTE,
    requiresConfirmation: entry.tier !== 'core',
  }
}

/** What re-checking authority after installation found. */
export interface AuthorityChange {
  /** Capabilities the installed package holds that the catalog did not show. */
  readonly widened: readonly string[]
  /** True when the installed package holds no more than was disclosed. */
  readonly asDisclosed: boolean
  /** What the user should do about it. */
  readonly advice: string | null
}

/**
 * Compare authority disclosed before install against what was installed.
 *
 * A package that gained authority between the catalog and the tarball is the
 * case the provisional label exists for, and it is reported as a change to
 * acknowledge rather than folded silently into the doctor report.
 * @param disclosed - Authority shown before installing.
 * @param installed - Authority derived from the installed package.
 * @returns What changed.
 */
export function compareAuthority(
  disclosed: PackageAuthority,
  installed: PackageAuthority,
): AuthorityChange {
  // Compared by capability key rather than by position in two rendered lists:
  // index alignment silently miscounts if the renderer ever omits a line.
  const widened = (Object.keys(installed) as (keyof PackageAuthority)[])
    .filter((capability) => installed[capability] && !disclosed[capability])
    .map((capability) => capability)
  return {
    widened,
    asDisclosed: widened.length === 0,
    advice: widened.length === 0
      ? null
      : `The installed package holds ${widened.join(', ')}, which the catalog did not show. `
        + 'Review it or remove it — the listing you approved described something narrower.',
  }
}

/**
 * Order a catalog for display.
 *
 * Core first, then qualified, then unreviewed; within a tier, by downloads when
 * reported. Popularity never lifts a package above a tier, because the tier is
 * about who vouches for it and popularity is not a vouch.
 * @param entries - Catalog entries.
 * @returns Ordered entries.
 */
export function orderCatalog(entries: readonly CatalogEntry[]): CatalogEntry[] {
  const rank: Record<CapabilityTier, number> = {
    'core': 0,
    'optional-qualified': 1,
    'community-unreviewed': 2,
  }
  return [...entries].sort((left, right) => {
    const byTier = rank[left.tier] - rank[right.tier]
    if (byTier !== 0) return byTier
    return (right.downloads ?? 0) - (left.downloads ?? 0)
  })
}
