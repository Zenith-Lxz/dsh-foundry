/**
 * Profile health reporting.
 *
 * The doctor reads a profile's real installed state — manifest, bundle layer
 * order, resolved dependencies, and the compatibility declaration each package
 * carries — and reports what is actually composed rather than what was
 * intended.
 *
 * It never labels a profile healthy on the strength of an absence. An
 * unresolvable package, a missing bundle declaration, and a duplicated owner
 * are all findings, because "nothing reported a problem" and "everything was
 * checked" are different statements and only one of them is useful.
 *
 * Credentials and workspace contents are not read here at all — not read and
 * then redacted, but never opened.
 * @module @dsh-foundry/plugin-governance/doctor
 */
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import type { CapabilityTier, CompatibilityFinding, PackageHealth } from '@dsh-foundry/daily-contract'
import { deriveAuthority, UNKNOWN_AUTHORITY, type PackageManifest } from './authority.ts'
import { redactDeep } from './redact.ts'

/** One profile's health. */
export interface ProfileHealth {
  readonly profile: string
  /** Bundle layers in application order. */
  readonly bundles: readonly string[]
  readonly packages: readonly PackageHealth[]
  readonly findings: readonly CompatibilityFinding[]
  /** True only when every package resolved and no finding was recorded. */
  readonly healthy: boolean
}

/** What the doctor needs to classify packages. */
export interface DoctorOptions {
  /** Package names that form the locked core set. */
  readonly corePackages?: readonly string[]
  /** Package names reviewed and qualified as optional. */
  readonly qualifiedPackages?: readonly string[]
}

/**
 * Classify a package into its capability tier.
 *
 * Anything not explicitly listed is `community-unreviewed`. Defaulting to the
 * least-trusted tier is what keeps an unknown package from inheriting trust by
 * omission.
 * @param packageName - Installed package name.
 * @param options - Known core and qualified sets.
 * @returns The tier.
 */
export function classifyTier(packageName: string, options: DoctorOptions = {}): CapabilityTier {
  if (options.corePackages?.includes(packageName) === true) return 'core'
  if (options.qualifiedPackages?.includes(packageName) === true) return 'optional-qualified'
  return 'community-unreviewed'
}

/**
 * Read a JSON file, treating any failure as absent.
 * @param path - Absolute file path.
 * @returns The parsed value, or `undefined`.
 */
function readJson(path: string): Record<string, unknown> | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
  } catch {
    // A malformed manifest is a finding the caller records, not a throw that
    // loses the rest of the report.
    return undefined
  }
}

/**
 * Inspect one profile directory.
 *
 * @param profileDir - Absolute path of the profile directory.
 * @param profile - Profile name, for the report.
 * @param options - Tier classification input.
 * @returns The profile's health.
 */
export function inspectProfile(profileDir: string, profile: string, options: DoctorOptions = {}): ProfileHealth {
  const findings: CompatibilityFinding[] = []
  const manifest = readJson(join(profileDir, 'package.json'))

  if (manifest === undefined) {
    return {
      profile,
      bundles: [],
      packages: [],
      findings: [{
        failure: 'missing-plugin-row',
        contract: join(profileDir, 'package.json'),
        consequence: 'the profile manifest is missing or unreadable, so nothing about this profile can be verified',
      }],
      healthy: false,
    }
  }

  const dsh = manifest['dsh'] as { profile?: { bundles?: unknown } } | undefined
  const bundles = Array.isArray(dsh?.profile?.bundles) ? (dsh.profile.bundles as string[]) : []
  const dependencies = Object.keys((manifest['dependencies'] as Record<string, string> | undefined) ?? {})

  const packages: PackageHealth[] = []
  const ownedIdentifiers = new Map<string, string>()

  for (const packageName of dependencies) {
    const packageDir = join(profileDir, 'node_modules', ...packageName.split('/'))
    const packageManifest = readJson(join(packageDir, 'package.json')) as PackageManifest | undefined
    const tier = classifyTier(packageName, options)
    const packageFindings: CompatibilityFinding[] = []

    if (packageManifest === undefined) {
      packageFindings.push({
        failure: 'missing-public-export',
        contract: packageName,
        consequence: 'the package is a declared dependency but did not resolve, so its rows cannot activate',
      })
    } else {
      const patch = packageManifest.dsh?.bundle?.patch
      if (patch !== undefined && !bundles.includes(packageName)) {
        packageFindings.push({
          failure: 'missing-plugin-row',
          contract: packageName,
          consequence: 'the package declares a Bundle patch but is not in the profile layer list, so it contributes nothing',
        })
      }
      // Two packages claiming the same Bundle patch id would silently let one
      // replace the other's rows depending on layer order.
      if (patch !== undefined) {
        const previous = ownedIdentifiers.get(patch)
        if (previous !== undefined) {
          packageFindings.push({
            failure: 'duplicate-owner',
            contract: patch,
            consequence: `both ${previous} and ${packageName} declare this Bundle patch`,
          })
        } else {
          ownedIdentifiers.set(patch, packageName)
        }
      }
    }

    packages.push({
      packageName,
      version: typeof packageManifest?.version === 'string' ? packageManifest.version : undefined,
      source: undefined,
      tier,
      activated: packageManifest !== undefined && packageFindings.length === 0,
      findings: packageFindings,
    })
    findings.push(...packageFindings)
  }

  // A bundle layer naming a package the profile does not depend on cannot load;
  // in-box official bundles are not dependencies, so only companion-scoped
  // names are checked here.
  for (const bundle of bundles) {
    if (bundle.startsWith('@deepseek-ai/')) continue
    if (!dependencies.includes(bundle)) {
      findings.push({
        failure: 'missing-plugin-row',
        contract: bundle,
        consequence: 'the profile lists this Bundle layer but does not depend on the package that provides it',
      })
    }
  }

  return { profile, bundles, packages, findings, healthy: findings.length === 0 }
}

/** One package's disclosure, as an install review renders it. */
export interface InstallReview {
  readonly packageName: string
  readonly version: string | undefined
  readonly tier: CapabilityTier
  readonly authority: ReturnType<typeof deriveAuthority>
  /** True when the manifest could not be read and authority was assumed maximal. */
  readonly authorityAssumed: boolean
}

/**
 * Build the disclosure shown before installing a non-core package.
 * @param packageDir - Absolute path of the package to review.
 * @param packageName - The package name.
 * @param options - Tier classification input.
 * @returns The review.
 */
export function reviewInstall(packageDir: string, packageName: string, options: DoctorOptions = {}): InstallReview {
  const manifest = readJson(join(packageDir, 'package.json')) as PackageManifest | undefined
  return {
    packageName,
    version: typeof manifest?.version === 'string' ? manifest.version : undefined,
    tier: classifyTier(packageName, options),
    // A package under review is one the user is adding to a profile, so it is
    // a candidate Host row by definition.
    authority: manifest === undefined ? UNKNOWN_AUTHORITY : deriveAuthority(manifest, { mountedAsHostRow: true }),
    authorityAssumed: manifest === undefined,
  }
}

/**
 * Render a health report as text safe to share.
 *
 * Redaction runs here, on the whole report, so no call site can emit an
 * unredacted fragment by forgetting.
 * @param health - The profile health.
 * @returns Redacted, human-readable report lines.
 */
export function renderReport(health: ProfileHealth): string {
  const safe = redactDeep(health)
  const lines: string[] = [
    `profile: ${safe.profile}`,
    `bundle layers: ${safe.bundles.join(' -> ') || '(none)'}`,
    `status: ${safe.healthy ? 'healthy' : `${safe.findings.length} finding(s)`}`,
    '',
  ]
  for (const entry of safe.packages) {
    lines.push(
      `  ${entry.activated ? 'ok  ' : 'FAIL'} ${entry.packageName}@${entry.version ?? 'unresolved'} [${entry.tier}]`,
    )
    for (const finding of entry.findings) lines.push(`         ${finding.failure}: ${finding.consequence}`)
  }
  return lines.join('\n')
}
