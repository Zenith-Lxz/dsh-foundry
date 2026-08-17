/**
 * Where a plugin came from, and what that does and does not tell you.
 *
 * The official plugin list answers "what is loaded". It cannot answer "who
 * shipped this and did anyone check it", because that is distribution
 * knowledge, not runtime knowledge. This module supplies the missing half
 * without replacing the official surface.
 *
 * Two rules make the answer trustworthy:
 *
 * - **Provenance comes from declared metadata, never from the name.** A package
 *   called `@dsh-foundry-tools/x` published by someone else must not read as
 *   ours, and matching on a string prefix is exactly how that happens.
 * - **Unknown is a real answer.** A package with no usable metadata is reported
 *   as `unknown` rather than sorted into the nearest plausible bucket. Silent
 *   classification is how a user plugin comes to look reviewed.
 * @module @dsh-foundry/plugin-governance/provenance
 */

import type { PluginProvenance, ProvenanceSource } from '@dsh-foundry/daily-contract'

// Re-exported so callers keep one import for the whole governance vocabulary;
// the definitions live in the contract package because the browser half renders
// them and this module reads the filesystem.
export { PROVENANCE_SOURCES, USER_AUTHORITY_WARNING } from '@dsh-foundry/daily-contract'
export type { PluginProvenance, ProvenanceSource } from '@dsh-foundry/daily-contract'

/** How a package's provenance was established. */
export interface ProvenanceEvidence {
  /** The field the answer came from, for a reader who wants to check it. */
  readonly field: string
  /** The value read from that field. */
  readonly value: string
}


/** The manifest fields provenance is read from. */
export interface PackageMetadata {
  readonly name?: string
  readonly version?: string
  readonly description?: string
  /** Publisher-declared distribution marker. */
  readonly dshFoundry?: { readonly distribution?: string, readonly qualified?: boolean }
  /** Official Harness plugin metadata. */
  readonly dsh?: unknown
  /** Where the profile manifest says the package was installed from. */
  readonly installedFrom?: string
}

/** The distribution name a Foundry package must declare to be recognized. */
export const FOUNDRY_DISTRIBUTION = 'dsh-foundry'

/** Scope the official Harness publishes under. */
export const OFFICIAL_SCOPE = '@deepseek-ai/'

/**
 * Decide where a package came from.
 *
 * The order is deliberate: an explicit Foundry declaration outranks everything,
 * then the official scope, then an install record. A package matching none of
 * those is `unknown`, which the view shows as unknown.
 * @param metadata - Manifest fields for the package.
 * @param context - Where the package was found.
 * @returns The source and the evidence for it.
 */
export function deriveProvenance(
  metadata: PackageMetadata,
  context: { readonly workspaceLocal?: boolean } = {},
): { readonly source: ProvenanceSource, readonly evidence: ProvenanceEvidence | null } {
  const declared = metadata.dshFoundry?.distribution
  if (declared === FOUNDRY_DISTRIBUTION) {
    return { source: 'foundry', evidence: { field: 'dshFoundry.distribution', value: declared } }
  }
  // Publisher scope, not a name prefix: `@deepseek-ai/` is a registry scope the
  // official project controls, whereas any string can start with `dsh-`.
  if (metadata.name?.startsWith(OFFICIAL_SCOPE) === true) {
    return { source: 'official', evidence: { field: 'name', value: metadata.name } }
  }
  if (context.workspaceLocal === true) {
    return { source: 'workspace', evidence: { field: 'location', value: 'workspace' } }
  }
  if (typeof metadata.installedFrom === 'string' && metadata.installedFrom.length > 0) {
    return { source: 'user', evidence: { field: 'installedFrom', value: metadata.installedFrom } }
  }
  // Nothing declared it. Guessing here is how a user plugin comes to look
  // official, so the view says it does not know.
  return { source: 'unknown', evidence: null }
}

/**
 * Decide whether this distribution qualified a package.
 *
 * Verified is a claim about *our* testing, so it requires both that the package
 * is ours and that it says it was qualified. A package that merely declares
 * `qualified: true` without being ours is not trusted — otherwise any publisher
 * could mark their own package verified in our view.
 * @param metadata - Manifest fields.
 * @param source - The derived source.
 * @returns True when this distribution qualified the package.
 */
export function isFoundryVerified(metadata: PackageMetadata, source: ProvenanceSource): boolean {
  return source === 'foundry' && metadata.dshFoundry?.qualified === true
}


/**
 * Describe what disabling a package would cost.
 * @param entry - The package, already classified.
 * @returns One sentence a person can decide from.
 */
export function describeDisableImpact(entry: Pick<PluginProvenance,
  'source' | 'packageName' | 'disableable' | 'bundle'>): string {
  if (!entry.disableable) {
    return entry.source === 'official'
      ? 'Required by the official composition; turning it off would leave other rows pointing at a missing service.'
      : 'Required by this distribution; turning it off would leave the workbench or desktop shell incomplete.'
  }
  return entry.source === 'foundry'
    ? 'Turning it off removes the Foundry feature it provides and leaves official behavior unchanged.'
    : 'Turning it off removes whatever this plugin contributed; the distribution does not depend on it.'
}

/**
 * Whether a row matches a search query.
 *
 * Matches the package name, the display name, and the source label, so
 * searching `foundry` finds this distribution's packages and `daily` finds the
 * daily layer — the two searches the official list answers with zero results
 * because it has no provenance to match against.
 * @param entry - The row.
 * @param query - Search text.
 * @returns True when the row should be shown.
 */
export function matchesQuery(entry: PluginProvenance, query: string): boolean {
  const needle = query.trim().toLowerCase()
  if (needle === '') return true
  return [entry.packageName, entry.displayName, entry.source, entry.bundle ?? '', entry.profile]
    .some((field) => field.toLowerCase().includes(needle))
}
