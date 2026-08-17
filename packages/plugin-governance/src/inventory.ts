/**
 * The installed-plugin inventory, with provenance attached.
 *
 * The official plugin list answers "what is loaded" from the runtime. It cannot
 * answer "who shipped this and did anyone check it", so searching it for
 * `daily` or `foundry` returns nothing even when this distribution's packages
 * are installed and running. This reads the same profile from disk and adds the
 * distribution knowledge the runtime does not carry.
 *
 * It does not replace the official surface. Both remain available, and this one
 * says on every render that it reports composition rather than behavior.
 * @module @dsh-foundry/plugin-governance/inventory
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import {
  deriveProvenance,
  describeDisableImpact,
  isFoundryVerified,
  type PackageMetadata,
  type PluginProvenance,
} from './provenance.ts'

/** What one profile contributed to the inventory. */
export interface ProfileInventory {
  readonly profile: string
  readonly entries: readonly PluginProvenance[]
}

/**
 * Read one package's manifest, tolerating an absent or malformed one.
 * @param packageDir - Directory holding `package.json`.
 * @returns The manifest, or `undefined` when it cannot be read.
 */
function readManifest(packageDir: string): PackageMetadata | undefined {
  const path = join(packageDir, 'package.json')
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as PackageMetadata
  } catch {
    // A malformed manifest yields no provenance evidence, which the caller
    // reports as `unknown` rather than guessing from the directory name.
    return undefined
  }
}

/**
 * Packages this distribution cannot run without.
 *
 * Listed rather than inferred: "can I turn this off" is a question the user
 * acts on, and inferring it from a dependency graph would answer confidently
 * in cases the graph does not actually cover.
 */
export const REQUIRED_FOUNDRY_PACKAGES: readonly string[] = [
  '@dsh-foundry/bundle',
  '@dsh-foundry/layout',
  '@dsh-foundry/native',
]

/**
 * Build the inventory for one profile.
 * @param profileDir - Absolute profile directory.
 * @param profile - Profile name.
 * @returns Every installed package with its provenance.
 */
export function inventoryProfile(profileDir: string, profile: string): ProfileInventory {
  const manifestPath = join(profileDir, 'package.json')
  if (!existsSync(manifestPath)) return { profile, entries: [] }

  let profileManifest: { dependencies?: Record<string, string>, dsh?: { profile?: { bundles?: unknown } } }
  try {
    profileManifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as typeof profileManifest
  } catch {
    // Without the profile manifest there is no dependency list to walk.
    return { profile, entries: [] }
  }

  const bundles = Array.isArray(profileManifest.dsh?.profile?.bundles)
    ? (profileManifest.dsh.profile.bundles as string[])
    : []
  const entries: PluginProvenance[] = []

  for (const packageName of Object.keys(profileManifest.dependencies ?? {}).sort()) {
    const packageDir = join(profileDir, 'node_modules', ...packageName.split('/'))
    const metadata = readManifest(packageDir) ?? {}
    const { source, evidence } = deriveProvenance({ ...metadata, name: metadata.name ?? packageName })
    const disableable = !REQUIRED_FOUNDRY_PACKAGES.includes(packageName) && source !== 'official'
    const bundle = bundles.find((layer) => layer === packageName)
      ?? bundles.find((layer) => layer.startsWith('@dsh-foundry/') && source === 'foundry')
      ?? null

    entries.push({
      packageName,
      displayName: typeof metadata.description === 'string' && metadata.description.length > 0
        ? metadata.description
        : packageName,
      // An absent manifest means the version is unknown, and printing the
      // range the profile requested would show a constraint as a fact.
      version: metadata.version ?? 'unknown',
      source,
      evidence,
      profile,
      bundle,
      enabled: true,
      foundryVerified: isFoundryVerified(metadata, source),
      disableable,
      disableImpact: describeDisableImpact({ source, packageName, disableable, bundle }),
    })
  }

  return { profile, entries }
}

/**
 * Build the inventory across every profile in a Harness home.
 * @param home - Harness home directory.
 * @returns One inventory per profile, sorted by name.
 */
export function inventoryHome(home: string): ProfileInventory[] {
  const profilesDir = join(home, 'profiles')
  if (!existsSync(profilesDir)) return []
  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => inventoryProfile(join(profilesDir, entry.name), entry.name))
    .sort((left, right) => left.profile.localeCompare(right.profile))
}

/** Counts a reader uses to judge what is installed. */
export interface InventorySummary {
  readonly total: number
  readonly foundry: number
  readonly official: number
  readonly unknown: number
  /** Packages running with user authority that this distribution did not review. */
  readonly unreviewed: number
}

/**
 * Summarize an inventory.
 * @param entries - Every row across the profiles being shown.
 * @returns The counts.
 */
export function summarize(entries: readonly PluginProvenance[]): InventorySummary {
  return {
    total: entries.length,
    foundry: entries.filter((entry) => entry.source === 'foundry').length,
    official: entries.filter((entry) => entry.source === 'official').length,
    unknown: entries.filter((entry) => entry.source === 'unknown').length,
    // Everything we did not ship and did not review, which is the set the
    // authority warning applies to.
    unreviewed: entries.filter((entry) => entry.source !== 'official' && !entry.foundryVerified).length,
  }
}
