/**
 * The doctor command.
 *
 * Answers one question — *what is actually installed in this profile, and what
 * authority did I grant it* — against the real Harness home rather than a
 * cached model of it.
 *
 * Output is redacted at the boundary, because a doctor report is the thing
 * people paste into issues. It also states its own blind spots: a report that
 * lists only findings reads as "everything else was verified", and this one
 * checks composition, not behavior.
 * @module @dsh-foundry/plugin-governance/cli
 */
import { existsSync, readdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { describeAuthority, AUTHORITY_WARNING } from './authority.ts'
import { inspectProfile, renderReport, reviewInstall, type DoctorOptions } from './doctor.ts'

/** What the doctor examined and concluded. */
export interface DoctorResult {
  readonly harnessHome: string
  readonly profiles: readonly string[]
  readonly report: string
  /** True when every inspected profile was healthy. */
  readonly healthy: boolean
}

/**
 * Resolve the Harness home the same way the official runtime does.
 * @returns Absolute path to the Harness home.
 */
export function harnessHome(): string {
  const configured = process.env['DSH_HOME']
  return configured !== undefined && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * List profiles present in a Harness home.
 * @param home - Harness home directory.
 * @returns Profile names, sorted.
 */
export function listProfiles(home: string): string[] {
  const profilesDir = join(home, 'profiles')
  if (!existsSync(profilesDir)) return []
  return readdirSync(profilesDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'node_modules')
    .map((entry) => entry.name)
    .sort()
}

/**
 * Run the doctor over one or every profile.
 * @param options - Home, profile selection, and tier classification.
 * @returns The rendered result.
 */
export function runDoctor(options: {
  readonly home?: string
  readonly profile?: string
  readonly tiers?: DoctorOptions
} = {}): DoctorResult {
  const home = options.home ?? harnessHome()
  const profiles = options.profile !== undefined ? [options.profile] : listProfiles(home)
  const sections: string[] = []
  let healthy = true

  if (profiles.length === 0) {
    return {
      harnessHome: home,
      profiles: [],
      report: `no profiles found in ${home}\n\nRun the desktop application once, or install a profile with `
        + '`dsh plugin --profile <name> add <package>`.',
      healthy: false,
    }
  }

  for (const profile of profiles) {
    const health = inspectProfile(join(home, 'profiles', profile), profile, options.tiers ?? {})
    if (!health.healthy) healthy = false
    sections.push(renderReport(health))

    for (const entry of health.packages) {
      if (entry.tier === 'core') continue
      // Non-core packages are the ones whose authority the user has to weigh,
      // so the disclosure travels with the report rather than living only in an
      // install prompt they saw once.
      const review = reviewInstall(join(home, 'profiles', profile, 'node_modules', entry.packageName), entry.packageName)
      const granted = describeAuthority(review.authority).filter((line) => line.granted)
      sections.push(
        `\n  authority — ${entry.packageName} [${entry.tier}]${review.authorityAssumed ? ' (assumed: manifest unreadable)' : ''}`,
        ...granted.map((line) => `    • ${line.capability}: ${line.meaning}`),
      )
    }
  }

  sections.push(
    '',
    AUTHORITY_WARNING,
    '',
    'This report covers composition, not behavior: it verifies what is installed and how it is '
    + 'layered, and does not execute plugin code or observe what it does at run time.',
  )

  return { harnessHome: home, profiles, report: sections.join('\n'), healthy }
}
