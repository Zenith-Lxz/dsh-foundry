/**
 * Deciding what to update, and whether it is safe to.
 *
 * Two things update independently and neither needs the application to be
 * downloaded again: the official DSH runtime inside the pinned range, and this
 * distribution's own packages. Both are package operations through the official
 * plugin command.
 *
 * The rule that makes an automatic DSH update defensible is that **a candidate
 * is qualified before it is applied**. The distribution depends on a fixed list
 * of public extension points; a new upstream release is installed into a
 * throwaway profile, probed for every one of them, and only offered if they all
 * still exist. A distribution that forked or vendored DSH cannot do this — it
 * can only merge and hope — so refusing an update with a named missing seam is
 * a property of the zero-diff design rather than extra caution.
 * @module @dsh-foundry/updater/plan
 */

/** What kind of thing an update covers. */
export type UpdateTarget = 'harness' | 'distribution'

/** A version available to move to. */
export interface Candidate {
  readonly target: UpdateTarget
  readonly packageName: string
  readonly current: string
  readonly available: string
}

/** Why a candidate is not offered. */
export type RejectionReason =
  | { readonly kind: 'out-of-range', readonly range: string }
  | { readonly kind: 'missing-extension-points', readonly points: readonly string[] }
  | { readonly kind: 'qualification-failed', readonly detail: string }
  | { readonly kind: 'not-newer' }

/** What the updater decided about one candidate. */
export type Decision =
  | { readonly candidate: Candidate, readonly offered: true, readonly rollbackTo: string }
  | { readonly candidate: Candidate, readonly offered: false, readonly reason: RejectionReason }

/**
 * Compare two dotted versions, prerelease-aware enough for this range.
 *
 * Handles the `0.1.0-rc.6` form the Harness uses: a prerelease sorts below its
 * own release, and numeric prerelease parts compare numerically so `rc.10`
 * follows `rc.9` rather than preceding it.
 * @param left - First version.
 * @param right - Second version.
 * @returns Negative, zero, or positive as `left` sorts before, with, or after `right`.
 */
export function compareVersions(left: string, right: string): number {
  const split = (value: string): { core: number[], pre: string[] } => {
    const [core, pre] = value.split('-')
    return {
      core: (core ?? '').split('.').map((part) => Number.parseInt(part, 10) || 0),
      pre: pre === undefined ? [] : pre.split('.'),
    }
  }
  const a = split(left)
  const b = split(right)
  for (let index = 0; index < Math.max(a.core.length, b.core.length); index += 1) {
    const difference = (a.core[index] ?? 0) - (b.core[index] ?? 0)
    if (difference !== 0) return difference
  }
  // No prerelease outranks any prerelease of the same core version.
  if (a.pre.length === 0 && b.pre.length > 0) return 1
  if (a.pre.length > 0 && b.pre.length === 0) return -1
  for (let index = 0; index < Math.max(a.pre.length, b.pre.length); index += 1) {
    const left0 = a.pre[index]
    const right0 = b.pre[index]
    if (left0 === right0) continue
    if (left0 === undefined) return -1
    if (right0 === undefined) return 1
    const leftNumber = Number(left0)
    const rightNumber = Number(right0)
    if (!Number.isNaN(leftNumber) && !Number.isNaN(rightNumber)) return leftNumber - rightNumber
    return left0 < right0 ? -1 : 1
  }
  return 0
}

/**
 * Whether a version satisfies a `>=x <y` range.
 *
 * Only the two-bound form the compatibility manifest uses is supported, and an
 * unrecognized range rejects rather than accepting: treating an unparsed range
 * as "anything goes" would let an untested major version install itself.
 * @param version - Candidate version.
 * @param range - Range from the compatibility manifest.
 * @returns True when the version is inside the range.
 */
export function satisfiesRange(version: string, range: string): boolean {
  const lower = /(?:^|\s)>=\s*([\w.-]+)/.exec(range)?.[1]
  const upper = /(?:^|\s)<\s*([\w.-]+)/.exec(range)?.[1]
  if (lower === undefined || upper === undefined) return false
  return compareVersions(version, lower) >= 0 && compareVersions(version, upper) < 0
}

/** What a probe of a candidate reported. */
export interface ProbeResult {
  /** Extension points the distribution needs that the candidate does not have. */
  readonly missing: readonly string[]
  /** Set when the probe could not run at all. */
  readonly failure: string | null
}

/**
 * Decide whether a candidate may be offered.
 * @param candidate - The available version.
 * @param range - Accepted range for the Harness; ignored for distribution updates.
 * @param probe - Runs the extension-point probe against a candidate.
 * @returns The decision, carrying the rollback target when offered.
 */
export async function decide(
  candidate: Candidate,
  range: string,
  probe: (candidate: Candidate) => Promise<ProbeResult>,
): Promise<Decision> {
  if (compareVersions(candidate.available, candidate.current) <= 0) {
    return { candidate, offered: false, reason: { kind: 'not-newer' } }
  }

  if (candidate.target === 'harness') {
    if (!satisfiesRange(candidate.available, range)) {
      return { candidate, offered: false, reason: { kind: 'out-of-range', range } }
    }
    let result: ProbeResult
    try {
      result = await probe(candidate)
    } catch (error) {
      return {
        candidate,
        offered: false,
        reason: { kind: 'qualification-failed', detail: describe(error) },
      }
    }
    if (result.failure !== null) {
      return { candidate, offered: false, reason: { kind: 'qualification-failed', detail: result.failure } }
    }
    if (result.missing.length > 0) {
      return { candidate, offered: false, reason: { kind: 'missing-extension-points', points: result.missing } }
    }
  }

  // Recorded now, while the installed version is still known: a rollback target
  // discovered after the update has already replaced it is a guess.
  return { candidate, offered: true, rollbackTo: candidate.current }
}

/**
 * Render a decision for a user-facing surface.
 * @param decision - The decision.
 * @returns One sentence saying what will happen, or why nothing will.
 */
export function describeDecision(decision: Decision): string {
  const { candidate } = decision
  const what = `${candidate.packageName} ${candidate.current} → ${candidate.available}`
  if (decision.offered) {
    return `${what}. Installed through the official plugin command; the application itself is not re-downloaded. `
      + `Roll back to ${decision.rollbackTo} at any time.`
  }
  switch (decision.reason.kind) {
    case 'not-newer':
      return `${candidate.packageName} is already at ${candidate.current}.`
    case 'out-of-range':
      return `${what} is outside the qualified range ${decision.reason.range}. `
        + 'A release outside the range has not been tested against this distribution, so it is not offered automatically.'
    case 'missing-extension-points':
      return `${what} was rejected: it no longer provides ${decision.reason.points.join(', ')}, which this distribution depends on. `
        + 'Staying on the current version is the correct outcome — this is exactly the check a forked distribution cannot make.'
    case 'qualification-failed':
      return `${what} could not be qualified (${decision.reason.detail}), so it is not offered. `
        + 'An unqualified update is refused rather than applied hopefully.'
  }
}

/**
 * Bound an error for a user-facing message.
 * @param error - The thrown value.
 * @returns A bounded description.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}
