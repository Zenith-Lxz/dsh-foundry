/**
 * Install rejection and lifecycle reporting.
 *
 * Two jobs, joined by one rule: **the distribution never deletes what it did
 * not create.**
 *
 * {@link classifySource} rejects install shapes that would require a second
 * plugin installer or an on-disk cache of this distribution's own — a legacy
 * `.dsh-plugin` repository, a bare Git URL, a loose directory. Accepting any of
 * them means owning a resolution and update path in parallel with pnpm's, and
 * two installers disagreeing about what is installed is the failure mode that
 * makes a profile unexplainable.
 *
 * {@link planRemoval} reports what disabling, updating, rolling back, or
 * removing a package will do *before* it happens, and separates registrations
 * the runtime withdraws automatically from data the plugin wrote. Plugin-owned
 * data is listed, never deleted: a user who wanted it gone can remove it, and a
 * user who did not cannot get it back.
 * @module @dsh-foundry/plugin-governance/lifecycle
 */

/** Install shapes a profile Bundle can carry. */
export type SourceKind = 'registry' | 'tarball-url' | 'legacy-dsh-plugin' | 'git' | 'local-path' | 'unknown'

/** Whether a source may be installed, and why not when it may not. */
export type SourceVerdict =
  | { readonly accepted: true, readonly kind: 'registry' | 'tarball-url' }
  | { readonly accepted: false, readonly kind: SourceKind, readonly reason: string, readonly remedy: string }

/** What a current install must look like. */
export const REQUIRED_FORM =
  'a published package installed into a profile with `dsh plugin --profile <name> add <package>`'

/**
 * Classify an install source and decide whether it is acceptable.
 * @param source - What the user asked to install.
 * @returns The verdict.
 */
export function classifySource(source: string): SourceVerdict {
  const trimmed = source.trim()

  if (/\.dsh-plugin(\/|$)|^dsh-plugin:/i.test(trimmed)) {
    return {
      accepted: false,
      kind: 'legacy-dsh-plugin',
      reason: 'This is a legacy `.dsh-plugin` repository. It is not a profile Bundle and installing it would need a second plugin installer alongside pnpm.',
      remedy: `Ask the author to publish it as ${REQUIRED_FORM}. Two installers disagreeing about what is installed is why this is refused rather than worked around.`,
    }
  }
  if (/^(git\+|git:|ssh:\/\/git@)|^[\w.-]+@[\w.-]+:.+\.git$|github\.com\/.+\.git$/i.test(trimmed)) {
    return {
      accepted: false,
      kind: 'git',
      reason: 'A Git source has no published version, so the profile could not record what is installed or verify it again later.',
      remedy: `Install ${REQUIRED_FORM}, or a tarball URL for a pre-release.`,
    }
  }
  if (/^(\.{1,2}\/|\/|[A-Za-z]:\\)|^file:/.test(trimmed)) {
    return {
      accepted: false,
      kind: 'local-path',
      reason: 'A local path binds this profile to one machine and to a working tree that can change under it.',
      remedy: `Install ${REQUIRED_FORM}. For local development, use the source repository's own dev profile instead of the installed one.`,
    }
  }
  if (/^https?:\/\/\S+\.(tgz|tar\.gz)$/i.test(trimmed)) {
    return { accepted: true, kind: 'tarball-url' }
  }
  if (/^(@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*(@[\w.^~><=|\s*-]+)?$/i.test(trimmed)) {
    return { accepted: true, kind: 'registry' }
  }
  return {
    accepted: false,
    kind: 'unknown',
    reason: `"${trimmed}" is not a form this distribution knows how to install.`,
    remedy: `Install ${REQUIRED_FORM}.`,
  }
}

/** A lifecycle operation on an installed package. */
export type LifecycleOperation = 'disable' | 'update' | 'rollback' | 'remove'

/** What a package contributed and left behind. */
export interface PackageFootprint {
  readonly packageName: string
  readonly version: string
  /** Registrations the runtime withdraws when the plugin unloads. */
  readonly reversibleRegistrations: readonly string[]
  /** Paths the plugin wrote that outlive it. */
  readonly ownedDataPaths: readonly string[]
  /** Other installed packages that declare this one. */
  readonly dependents: readonly string[]
  /** The version a rollback would return to, when one is recorded. */
  readonly previousVersion: string | null
}

/** What an operation will do. */
export interface LifecyclePlan {
  readonly operation: LifecycleOperation
  readonly packageName: string
  /** Registrations that unwind automatically. */
  readonly withdrawn: readonly string[]
  /**
   * Data the operation leaves in place, with where to find it.
   *
   * Never deleted by this distribution: it did not write this data, and an
   * unwanted file is recoverable while a deleted one is not.
   */
  readonly retainedData: readonly string[]
  /** Why the operation cannot proceed, when it cannot. */
  readonly blocked: string | null
  /** What the user should know before confirming. */
  readonly notes: readonly string[]
}

/**
 * Plan a lifecycle operation.
 * @param operation - What the user asked for.
 * @param footprint - What the package contributed and left behind.
 * @returns The plan.
 */
export function planRemoval(operation: LifecycleOperation, footprint: PackageFootprint): LifecyclePlan {
  const notes: string[] = []
  let blocked: string | null = null

  if (footprint.dependents.length > 0 && (operation === 'remove' || operation === 'disable')) {
    // Proceeding would leave a dependent referring to something absent, which
    // fails at load rather than at the moment the user chose it.
    blocked = `${footprint.dependents.join(', ')} declare ${footprint.packageName}. `
      + `${operation === 'remove' ? 'Remove' : 'Disable'} them first, or this profile will fail to load.`
  }

  if (operation === 'rollback' && footprint.previousVersion === null) {
    blocked = `No previous version of ${footprint.packageName} is recorded in this profile, so there is nothing to roll back to.`
  }

  if (operation === 'update' || operation === 'rollback') {
    notes.push(
      'Composition outside this package is untouched: other rows keep their order, versions, and settings.',
    )
  }
  if (operation === 'disable') {
    notes.push('The package stays installed and can be re-enabled without downloading anything.')
  }
  if (footprint.ownedDataPaths.length > 0) {
    notes.push(
      `${footprint.ownedDataPaths.length} path(s) written by this package are listed below and left in place. `
      + 'Delete them yourself if you want them gone.',
    )
  }

  return {
    operation,
    packageName: footprint.packageName,
    withdrawn: blocked === null ? footprint.reversibleRegistrations : [],
    retainedData: footprint.ownedDataPaths,
    blocked,
    notes,
  }
}

/**
 * Render a lifecycle plan for a confirmation prompt.
 * @param plan - The plan.
 * @returns Lines to show.
 */
export function renderPlan(plan: LifecyclePlan): string[] {
  if (plan.blocked !== null) {
    return [`${plan.operation} ${plan.packageName}: BLOCKED`, '', plan.blocked]
  }
  const lines = [`${plan.operation} ${plan.packageName}`, '']
  if (plan.withdrawn.length > 0) {
    lines.push('withdrawn automatically:', ...plan.withdrawn.map((entry) => `  - ${entry}`), '')
  }
  if (plan.retainedData.length > 0) {
    lines.push('left in place (not deleted):', ...plan.retainedData.map((entry) => `  - ${entry}`), '')
  }
  lines.push(...plan.notes)
  return lines
}
