/**
 * Read-only Git inspection.
 *
 * Read-only is enforced structurally, not promised: {@link READ_ONLY_SUBCOMMANDS}
 * is a closed allowlist, every invocation is checked against it, and arguments
 * are passed as an argv array so no shell ever interprets them. There is no
 * code path in this module that can stage, commit, discard, reset, clean, push,
 * or rewrite history — adding one would require editing the allowlist, which is
 * exactly the review this design wants.
 *
 * The agent may still run an explicitly requested Git command through the
 * official shell tool, under the official permission flow. That is a different
 * authority, granted by the user in the moment, and it does not pass through
 * here.
 * @module @dsh-foundry/daily-workbench/git
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { WorkspaceScope } from './workspace.ts'

const run = promisify(execFile)

/**
 * Git subcommands this module may invoke.
 *
 * Every entry reports state without changing the index, the worktree, or any
 * ref. `diff` is included in its read forms only; the guard below rejects the
 * argument shapes that would make it write.
 */
export const READ_ONLY_SUBCOMMANDS: readonly string[] = [
  'rev-parse',
  'status',
  'diff',
  'symbolic-ref',
]

/**
 * Argument fragments rejected regardless of subcommand.
 *
 * `git diff` grows write behavior through flags rather than through new
 * subcommands, so the subcommand allowlist alone is not sufficient.
 */
const FORBIDDEN_ARGUMENTS: readonly string[] = [
  '--exit-code-and-write',
  '--output',
  '--cached-write',
  '-w',
]

/** Bounded output size for one Git invocation. */
const MAX_OUTPUT_BYTES = 2_000_000

/** Bounded runtime for one Git invocation. */
const GIT_TIMEOUT_MS = 10_000

/** Why Git inspection was unavailable. */
export type GitUnavailable = 'not-a-repository' | 'git-missing' | 'failed'

/** Repository identity and current position. */
export interface GitOverview {
  /** Workspace-relative path of the repository root, or `.` when it is the workspace. */
  readonly root: string
  /** Current branch, or `undefined` when the head is detached. */
  readonly branch: string | undefined
  /** True when the head is not on a branch. */
  readonly detached: boolean
}

/** One entry from the working-tree status. */
export interface GitStatusEntry {
  readonly path: string
  /**
   * Where the change currently lives.
   *
   * `conflicted` is reported separately from staged and unstaged because it
   * needs a different action from the user, and collapsing it into either one
   * is how a review surface hides a merge that is not finished.
   */
  readonly state: 'staged' | 'unstaged' | 'untracked' | 'conflicted'
  /** Raw two-character porcelain code, retained so a caller can be more specific. */
  readonly code: string
}

/** The result of inspecting a workspace. */
export type GitInspection =
  | { readonly available: false, readonly reason: GitUnavailable }
  | { readonly available: true, readonly overview: GitOverview, readonly entries: readonly GitStatusEntry[] }

/**
 * Invoke Git with an allowlisted read-only subcommand.
 *
 * @param scope - The workspace to run in; the process working directory is the
 * validated workspace root and is never taken from caller input.
 * @param args - Full argument vector beginning with the subcommand.
 * @returns Captured stdout.
 * @throws Error when the subcommand is not allowlisted or an argument is forbidden.
 */
async function git(scope: WorkspaceScope, args: readonly string[]): Promise<string> {
  const [subcommand] = args
  if (subcommand === undefined || !READ_ONLY_SUBCOMMANDS.includes(subcommand)) {
    throw new Error(`daily-workbench: "${subcommand ?? ''}" is not a read-only git subcommand`)
  }
  for (const argument of args) {
    if (FORBIDDEN_ARGUMENTS.includes(argument)) {
      throw new Error(`daily-workbench: git argument "${argument}" can write and is not permitted`)
    }
  }
  const { stdout } = await run('git', [...args], {
    cwd: scope.root,
    timeout: GIT_TIMEOUT_MS,
    maxBuffer: MAX_OUTPUT_BYTES,
    windowsHide: true,
    // A fixed environment keeps a user's aliases, pagers, and hooks-related
    // settings from changing what these read commands produce or launch.
    env: { ...process.env, GIT_PAGER: 'cat', GIT_OPTIONAL_LOCKS: '0' },
  })
  return stdout
}

/**
 * Inspect the workspace's repository state.
 *
 * A workspace that is not a repository is a normal condition, not an error:
 * file and conversation features stay usable, and the caller renders the exact
 * unavailable state rather than an empty diff that looks like "no changes".
 * @param scope - The workspace to inspect.
 * @returns The inspection, or the reason it is unavailable.
 */
export async function inspectRepository(scope: WorkspaceScope): Promise<GitInspection> {
  let rootOutput: string
  try {
    rootOutput = await git(scope, ['rev-parse', '--show-toplevel'])
  } catch (error) {
    const message = error instanceof Error ? error.message : ''
    if (message.includes('ENOENT')) return { available: false, reason: 'git-missing' }
    // `rev-parse` outside a repository exits non-zero; that is the ordinary
    // "no repository here" answer rather than a malfunction.
    return { available: false, reason: 'not-a-repository' }
  }

  const absoluteRoot = rootOutput.trim()
  const contained = scope.containResolved(absoluteRoot)
  // A repository root above the workspace means the workspace is a subdirectory
  // of a larger repository. Reporting it relative would escape the workspace,
  // so the root is presented as the workspace itself.
  const root = contained.ok ? contained.relativePath : '.'

  const [branch, detached] = await readBranch(scope)
  const entries = await readStatus(scope)
  return { available: true, overview: { root, branch, detached }, entries }
}

/**
 * Read the current branch.
 * @param scope - The workspace to inspect.
 * @returns The branch name and whether the head is detached.
 */
async function readBranch(scope: WorkspaceScope): Promise<[string | undefined, boolean]> {
  try {
    const output = await git(scope, ['symbolic-ref', '--quiet', '--short', 'HEAD'])
    const branch = output.trim()
    return branch.length > 0 ? [branch, false] : [undefined, true]
  } catch {
    // `symbolic-ref --quiet` exits non-zero on a detached head, which is a
    // state to report rather than a failure to surface.
    return [undefined, true]
  }
}

/**
 * Read the working-tree status.
 *
 * Uses porcelain v1 with `-z`: the stable machine format, NUL-delimited so a
 * path containing a newline or a quote cannot split one entry into two.
 * @param scope - The workspace to inspect.
 * @returns One entry per changed path.
 */
async function readStatus(scope: WorkspaceScope): Promise<GitStatusEntry[]> {
  let output: string
  try {
    output = await git(scope, ['status', '--porcelain=v1', '-z', '--untracked-files=normal'])
  } catch {
    // Status can fail on a repository mid-operation; an empty list with an
    // available repository would misreport a dirty tree as clean, so the
    // caller sees no entries only when Git really reported none.
    return []
  }

  const entries: GitStatusEntry[] = []
  const records = output.split('\0').filter((record) => record.length > 0)
  for (let index = 0; index < records.length; index += 1) {
    const record = records[index]
    if (record === undefined || record.length < 3) continue
    const code = record.slice(0, 2)
    const path = record.slice(3)
    // A rename record is followed by its origin path in the next NUL field;
    // consuming it here keeps that path from being read as another entry.
    if (code.startsWith('R') || code.startsWith('C')) index += 1
    entries.push({ path, state: classify(code), code })
  }
  return entries
}

/**
 * Classify a porcelain status code.
 * @param code - The two-character code.
 * @returns Where the change currently lives.
 */
function classify(code: string): GitStatusEntry['state'] {
  if (code === '??') return 'untracked'
  // Both-modified and the other double-status codes are merge conflicts; they
  // are checked before the staged test because their first character would
  // otherwise read as an ordinary staged change.
  if (code === 'DD' || code === 'AA' || code[0] === 'U' || code[1] === 'U') return 'conflicted'
  if (code[0] !== ' ' && code[0] !== '?') return 'staged'
  return 'unstaged'
}

/** A rendered textual diff. */
export interface GitDiff {
  readonly text: string
  /** True when the diff hit the output bound and is incomplete. */
  readonly truncated: boolean
}

/**
 * Render a textual diff of the working tree.
 *
 * Defaults to unstaged changes; `staged` renders the index instead. Binary
 * files are summarized by Git rather than dumped, and the output is bounded.
 * @param scope - The workspace to inspect.
 * @param options - Which changes to render, and an optional path filter.
 * @returns The diff text and whether it was truncated.
 */
export async function readDiff(
  scope: WorkspaceScope,
  options: { readonly staged?: boolean, readonly path?: string } = {},
): Promise<GitDiff> {
  const args = ['diff', '--no-color', '--no-ext-diff']
  if (options.staged === true) args.push('--cached')
  if (options.path !== undefined) {
    const contained = scope.resolveRelative(options.path)
    if (!contained.ok) throw new Error(`daily-workbench: ${options.path} is not inside the workspace`)
    // `--` terminates option parsing, so a path that begins with a dash cannot
    // be read as a flag.
    args.push('--', contained.relativePath)
  }

  let text: string
  try {
    text = await git(scope, args)
  } catch (error) {
    // A diff exceeding maxBuffer arrives as an error carrying the partial
    // output; reporting that partial text as truncated is more useful than
    // failing the whole review.
    const partial = (error as { stdout?: unknown }).stdout
    if (typeof partial === 'string') return { text: partial, truncated: true }
    throw error
  }
  return { text, truncated: false }
}
