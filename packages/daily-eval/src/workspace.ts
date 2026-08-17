/**
 * Provisioning a clean workspace and judging it with the task's oracle.
 *
 * Each run gets its own copy of the fixture, so one run cannot observe or
 * inherit another's edits. Oracles execute inside that copy with the task's
 * timeout, and the process tree is killed on timeout rather than left to keep
 * holding the directory.
 *
 * The oracle's verdict is only trusted when the oracle itself is trustworthy:
 * {@link oracleRejectsPristine} checks that a task's oracle *fails* on the
 * untouched fixture. An oracle that passes before any work is done would score
 * every configuration as successful.
 * @module @dsh-foundry/daily-eval/workspace
 */
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { TaskManifest } from './schema.ts'

/** Files the agent must never see: they are the answer key. */
export const ORACLE_FILES = ['verify.mjs']

/** A provisioned workspace. */
export interface Workspace {
  readonly path: string
  /**
   * Snapshot of the workspace after setup ran and before the agent started.
   *
   * Changes are measured against this, not against the fixture directory: a
   * fixture's own setup may write files (the Git review task creates the very
   * diff under review), and counting those as agent writes would report an
   * out-of-scope write for work the agent never did.
   */
  readonly baseline: string
  /** Remove the workspace and its baseline. Safe to call twice. */
  dispose(): void
}

/**
 * Copy a task's fixture into a fresh directory and run its setup, if any.
 * @param task - The task.
 * @param corpusRoot - Corpus root the fixture path is relative to.
 * @returns The provisioned workspace.
 */
export function provision(task: TaskManifest, corpusRoot: string): Workspace {
  const path = mkdtempSync(join(tmpdir(), `dsh-eval-${task.id}-`))
  cpSync(join(corpusRoot, task.fixture), path, { recursive: true })

  const setup = join(path, 'setup.mjs')
  if (existsSync(setup)) {
    const result = spawnSync(process.execPath, ['setup.mjs'], { cwd: path, encoding: 'utf8', timeout: 60_000 })
    if (result.status !== 0) {
      rmSync(path, { recursive: true, force: true })
      throw new Error(`fixture setup failed for ${task.id}: ${result.stderr ?? ''}${result.stdout ?? ''}`)
    }
  }

  // The oracle is the answer key. Leaving it in the workspace turns every task
  // into "read the assertions and satisfy them", which is a different skill
  // from the one each task claims to measure — and it is why two very different
  // compositions both scored 99.2% on the first qualifying sweep.
  for (const file of ORACLE_FILES) {
    const inWorkspace = join(path, file)
    if (existsSync(inWorkspace)) rmSync(inWorkspace)
  }

  const baseline = mkdtempSync(join(tmpdir(), `dsh-eval-baseline-${task.id}-`))
  cpSync(path, baseline, { recursive: true })

  let disposed = false
  return {
    path,
    baseline,
    dispose() {
      if (disposed) return
      disposed = true
      rmSync(path, { recursive: true, force: true })
      rmSync(baseline, { recursive: true, force: true })
    },
  }
}

/** What running an oracle produced. */
export interface OracleResult {
  readonly passed: boolean
  /** Combined output, trimmed to a size a report can carry. */
  readonly evidence: string
  readonly timedOut: boolean
}

/** Bytes of oracle output retained. Enough to see an assertion, not a build log. */
export const ORACLE_EVIDENCE_LIMIT = 4000

/**
 * Run a task's oracle in a workspace.
 * @param task - The task, whose timeout bounds the run.
 * @param workspacePath - Where to run.
 * @param corpusRoot - Corpus root, holding the withheld oracle.
 * @returns The oracle's verdict and evidence.
 */
export function runOracle(task: TaskManifest, workspacePath: string, corpusRoot: string): OracleResult {
  // Copied in only to judge, then removed: the agent never had a turn in which
  // it could read this file. Required rather than optional, because a caller
  // that omitted it got a module-not-found error reported as a task failure.
  const restored: string[] = []
  for (const file of ORACLE_FILES) {
    const source = join(corpusRoot, task.fixture, file)
    if (!existsSync(source)) continue
    cpSync(source, join(workspacePath, file))
    restored.push(join(workspacePath, file))
  }
  const result = spawnSync(task.oracle.command, [...task.oracle.args], {
    cwd: workspacePath,
    encoding: 'utf8',
    timeout: task.timeoutMs,
    // Kill the whole tree: an oracle that spawned a server would otherwise keep
    // the workspace alive past its own timeout.
    killSignal: 'SIGKILL',
  })
  for (const file of restored) rmSync(file, { force: true })
  const combined = `${result.stdout ?? ''}${result.stderr ?? ''}`.trim()
  return {
    passed: result.status === 0,
    evidence: combined.length > ORACLE_EVIDENCE_LIMIT
      ? `${combined.slice(0, ORACLE_EVIDENCE_LIMIT)}\n… truncated`
      : combined,
    timedOut: result.signal === 'SIGKILL' || (result.error as NodeJS.ErrnoException | undefined)?.code === 'ETIMEDOUT',
  }
}

/**
 * Check that a task's oracle rejects the untouched fixture.
 *
 * This is the property that makes every downstream number mean anything: an
 * oracle that already passes measures nothing, and would report every
 * configuration as fully successful.
 * @param task - The task to check.
 * @param corpusRoot - Corpus root.
 * @returns `null` when the oracle correctly rejects, or the problem otherwise.
 */
export function oracleRejectsPristine(task: TaskManifest, corpusRoot: string): string | null {
  let workspace: Workspace
  try {
    workspace = provision(task, corpusRoot)
  } catch (error) {
    return `fixture could not be provisioned: ${String(error)}`
  }
  try {
    const result = runOracle(task, workspace.path, corpusRoot)
    if (result.timedOut) return 'oracle timed out on the untouched fixture'
    if (result.passed) {
      return 'oracle passes on the untouched fixture, so it cannot distinguish a solved task from an untouched one'
    }
    return null
  } finally {
    workspace.dispose()
  }
}

/**
 * Check that a task's oracle accepts its reference solution.
 *
 * The other half of {@link oracleRejectsPristine}: an oracle that always fails
 * would satisfy that check while measuring nothing. Together the two prove the
 * oracle discriminates.
 * @param task - The task to check.
 * @param corpusRoot - Corpus root, holding `solutions/<task-id>`.
 * @returns `null` when the oracle correctly accepts, or the problem otherwise.
 */
export function oracleAcceptsSolution(task: TaskManifest, corpusRoot: string): string | null {
  const solution = join(corpusRoot, 'solutions', task.id)
  if (!existsSync(solution)) return `no reference solution at solutions/${task.id}`
  const workspace = provision(task, corpusRoot)
  try {
    cpSync(solution, workspace.path, { recursive: true })
    // Measured before the oracle runs: an oracle may create files of its own,
    // and those are not writes the solution made.
    const outOfScope = outOfScopeWrites(task, changedPaths(workspace))
    const result = runOracle(task, workspace.path, corpusRoot)
    if (result.timedOut) return 'oracle timed out on the reference solution'
    if (!result.passed) return `oracle rejects its own reference solution: ${result.evidence}`
    if (outOfScope.length > 0) {
      // A solution outside the declared scope means the scope is wrong, and
      // every out-of-scope-write metric derived from it would be miscounted.
      return `reference solution writes outside the declared allowed scope: ${outOfScope.join(', ')}`
    }
    return null
  } finally {
    workspace.dispose()
  }
}

/**
 * List paths the agent changed, relative to the post-setup baseline.
 * @param workspace - The workspace after a run.
 * @returns Changed paths, relative to the workspace root.
 */
export function changedPaths(workspace: Workspace): string[] {
  const workspacePath = workspace.path
  const result = spawnSync('diff', ['-rq', workspace.baseline, workspacePath], { encoding: 'utf8' })
  const changed: string[] = []
  for (const line of (result.stdout ?? '').split('\n')) {
    const differ = /^Files .* and (.*) differ$/.exec(line)
    if (differ !== null) changed.push(differ[1]!.slice(workspacePath.length + 1))
    const only = /^Only in (.*): (.*)$/.exec(line)
    if (only === null) continue
    if (only[1]!.startsWith(workspacePath)) {
      // Present in the workspace and not the baseline: the agent added it.
      changed.push(join(only[1]!.slice(workspacePath.length + 1), only[2]!))
    } else if (only[1]!.startsWith(workspace.baseline)) {
      // Present in the baseline and not the workspace: the agent deleted it.
      // Missing this half let a run that removed its own oracle report zero
      // changed paths and zero out-of-scope writes.
      changed.push(join(only[1]!.slice(workspace.baseline.length + 1), only[2]!))
    }
  }
  return changed.filter((path) => path.length > 0).sort()
}

/**
 * Count changed lines between the baseline and the workspace.
 *
 * Measures review burden, which verified success does not: two runs can both
 * pass while one rewrote a file and the other changed a line.
 * @param workspace - The workspace after a run.
 * @returns Added plus removed lines, or `null` when diff is unavailable.
 */
export function diffLineCount(workspace: Workspace): number | null {
  const result = spawnSync('diff', ['-ru', workspace.baseline, workspace.path], { encoding: 'utf8' })
  // diff exits 0 when identical and 1 when different; anything else means it
  // could not run, and a fabricated 0 would read as "changed nothing".
  if (result.status !== 0 && result.status !== 1) return null
  let count = 0
  for (const line of (result.stdout ?? '').split('\n')) {
    if ((line.startsWith('+') && !line.startsWith('+++')) || (line.startsWith('-') && !line.startsWith('---'))) {
      count += 1
    }
  }
  return count
}

/**
 * Find changed paths that fall outside a task's allowed scope.
 * @param task - The task, whose `allowedScope` bounds writes.
 * @param changed - Paths that changed.
 * @returns Paths written outside the allowed scope.
 */
export function outOfScopeWrites(task: TaskManifest, changed: readonly string[]): string[] {
  return changed.filter((path) => {
    const normalized = path.split('\\').join('/')
    // Byproducts of running the fixture, not agent writes.
    if (normalized === '.git' || normalized.startsWith('.git/')) return false
    return !task.allowedScope.some(
      (allowed) => normalized === allowed || normalized.startsWith(`${allowed}/`),
    )
  })
}
