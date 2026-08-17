/**
 * Workspace containment — the security core of the workbench.
 *
 * Every path the workbench accepts from a client, and every path it returns,
 * passes through here. The rule is one sentence: a path is usable only if its
 * **fully resolved real location** is the workspace root or lives beneath it.
 *
 * Resolving before comparing is the whole point. A prefix test on the textual
 * path accepts `/work/../etc/passwd` and accepts a symlink inside the workspace
 * pointing anywhere on the disk; a test on the real path does not. Symlinks are
 * resolved rather than rejected because they are ordinary in real repositories
 * — what matters is where they land.
 *
 * Results always leave as normalized workspace-relative POSIX paths, so a
 * client never receives an absolute host path it did not already know.
 * @module @dsh-foundry/daily-workbench/workspace
 */
import { realpathSync } from 'node:fs'
import { isAbsolute, relative, resolve, sep } from 'node:path'

/** Why a path was refused. */
export type ContainmentFailure =
  | 'empty'
  | 'not-relative'
  | 'escapes-workspace'
  | 'missing'
  | 'invalid'

/** The outcome of validating one candidate path. */
export type ContainmentResult =
  | { readonly ok: true, readonly relativePath: string, readonly absolutePath: string }
  | { readonly ok: false, readonly failure: ContainmentFailure }

/**
 * A resolved workspace root.
 *
 * Constructed once per workspace so the root's own real path is resolved a
 * single time: comparing a resolved candidate against an unresolved root would
 * reject every path in a workspace that is itself reached through a symlink,
 * which is the normal case on macOS (`/tmp` → `/private/tmp`).
 */
export class WorkspaceScope {
  /** The workspace root as the operating system really names it. */
  readonly root: string

  /**
   * @param root - Absolute path to the workspace root.
   * @throws Error when the root is not absolute or cannot be resolved.
   */
  constructor(root: string) {
    if (!isAbsolute(root)) throw new Error('workspace root must be an absolute path')
    this.root = realpathSync(root)
  }

  /**
   * Validate a workspace-relative candidate path.
   *
   * Rejects absolute inputs outright: the client's vocabulary is relative
   * paths, and accepting an absolute one would let a caller probe the host by
   * observing which paths are refused for containment versus for absence.
   * @param candidate - Workspace-relative path, as typed or selected.
   * @returns The normalized relative path and its real absolute location, or the failure.
   */
  resolveRelative(candidate: string): ContainmentResult {
    const trimmed = candidate.trim()
    if (trimmed.length === 0) return { ok: false, failure: 'empty' }
    // A NUL byte truncates the path at the system-call boundary, so a name
    // containing one never means what it appears to mean.
    if (trimmed.includes('\0')) return { ok: false, failure: 'invalid' }
    if (isAbsolute(trimmed)) return { ok: false, failure: 'not-relative' }

    const target = resolve(this.root, trimmed)
    let real: string
    try {
      real = realpathSync(target)
    } catch {
      // The path does not exist, or a component is unreadable. Both are
      // reported as missing: distinguishing them would disclose the existence
      // of paths the caller cannot otherwise observe.
      return { ok: false, failure: 'missing' }
    }
    return this.#contain(real)
  }

  /**
   * Validate a path the workbench itself produced, such as a search hit.
   *
   * Separate from {@link resolveRelative} because the input is already an
   * absolute real path from a traversal this module bounded; re-resolving it
   * would cost a syscall per result with nothing left to learn.
   * @param absoluteRealPath - Absolute, already-resolved path.
   * @returns The normalized relative path, or the failure.
   */
  containResolved(absoluteRealPath: string): ContainmentResult {
    return this.#contain(absoluteRealPath)
  }

  /**
   * Compare a resolved path against the resolved root.
   * @param real - Absolute real path.
   * @returns The containment result.
   */
  #contain(real: string): ContainmentResult {
    if (real === this.root) return { ok: true, relativePath: '.', absolutePath: real }
    const rel = relative(this.root, real)
    // `relative` yields a `..` prefix exactly when the target sits outside, and
    // an absolute result when the two share no root at all (a different drive).
    if (rel.length === 0 || rel.startsWith('..') || isAbsolute(rel)) {
      return { ok: false, failure: 'escapes-workspace' }
    }
    return { ok: true, relativePath: toPosix(rel), absolutePath: real }
  }
}

/**
 * Present a path with forward slashes.
 *
 * Workbench results are a stable client vocabulary, so they use one separator
 * on every platform. This applies **only** to relative paths the workbench
 * returns; a native absolute path crossing the desktop bridge stays opaque and
 * is never rewritten.
 * @param path - Path using the platform separator.
 * @returns The path with `/` separators.
 */
export function toPosix(path: string): string {
  return sep === '/' ? path : path.split(sep).join('/')
}
