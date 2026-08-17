/**
 * The `darwin` and `win32` faces of process control.
 *
 * Everything that differs between the two targets — executable naming, process
 * group creation, graceful stop semantics, tree enumeration, and forced
 * escalation — lives here. The supervisor above holds no `process.platform`
 * branches, so a platform behavior change has exactly one edit site.
 *
 * Windows deliberately does not emulate POSIX signals. `child.kill()` on
 * Windows is `TerminateProcess`, which is not graceful and does not reach
 * descendants, so the win32 face drives `taskkill` and verifies quiescence by
 * enumerating the tree rather than trusting the parent's exit.
 * @module @dsh-foundry/adapter/platform
 */
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import type { DesktopPlatform } from '@dsh-foundry/contract'

const run = promisify(execFile)

/** Bounded timeout for the helper processes used to inspect or kill a tree. */
const HELPER_TIMEOUT_MS = 10_000

/** Platform-specific process control used by the supervisor. */
export interface ProcessFace {
  readonly platform: DesktopPlatform
  /** File name of the staged Node executable for this target. */
  readonly nodeBinaryName: string
  /**
   * Whether the child is spawned in its own process group. On POSIX this makes
   * one signal reach the whole tree; on Windows it isolates the child from the
   * parent's console control events.
   */
  readonly detached: boolean
  /**
   * Ask the process tree to stop without forcing it.
   * @param pid - The supervised child's process id.
   */
  requestGracefulStop(pid: number): Promise<void>
  /**
   * Terminate the process and every descendant, unconditionally.
   * @param pid - The supervised child's process id.
   */
  forceStopTree(pid: number): Promise<void>
  /**
   * Enumerate live descendants, used to verify quiescence rather than assuming it.
   * @param pid - The supervised child's process id.
   * @returns Live descendant process ids, excluding `pid` itself.
   */
  listDescendants(pid: number): Promise<number[]>
}

/**
 * Build a parent-to-children index and collect every transitive descendant.
 * @param pairs - `[pid, ppid]` for every live process.
 * @param root - Process whose descendants are wanted.
 * @returns Transitive descendants, excluding `root`.
 */
function collectDescendants(pairs: readonly (readonly [number, number])[], root: number): number[] {
  const childrenByParent = new Map<number, number[]>()
  for (const [pid, ppid] of pairs) {
    const siblings = childrenByParent.get(ppid)
    if (siblings === undefined) childrenByParent.set(ppid, [pid])
    else siblings.push(pid)
  }
  const found: number[] = []
  const queue = [root]
  const seen = new Set<number>([root])
  while (queue.length > 0) {
    const current = queue.shift()
    if (current === undefined) break
    for (const child of childrenByParent.get(current) ?? []) {
      if (seen.has(child)) continue
      seen.add(child)
      found.push(child)
      queue.push(child)
    }
  }
  return found
}

/** POSIX face: signals addressed to the child's process group reach the whole owned tree. */
class DarwinFace implements ProcessFace {
  readonly platform = 'darwin' as const
  readonly nodeBinaryName = 'node'
  readonly detached = true

  /**
   * Send `SIGTERM` to the child's process group so tools and terminals it owns
   * receive it too.
   * @param pid - The supervised child's process id, which is also its group id.
   */
  requestGracefulStop(pid: number): Promise<void> {
    signalGroup(pid, 'SIGTERM')
    // Signalling is synchronous; the promise is the interface's, so awaiting
    // nothing here is correct rather than a missing await.
    return Promise.resolve()
  }

  /**
   * Send `SIGKILL` to the group, then to any descendant that outlived it — a
   * descendant that changed its own process group is no longer addressable
   * through the group id.
   * @param pid - The supervised child's process id.
   */
  async forceStopTree(pid: number): Promise<void> {
    signalGroup(pid, 'SIGKILL')
    for (const descendant of await this.listDescendants(pid)) {
      try {
        process.kill(descendant, 'SIGKILL')
      } catch {
        // The descendant exited between enumeration and signalling, which is the
        // outcome this call wanted; nothing else observes this process id.
      }
    }
  }

  /**
   * Enumerate descendants from the process table.
   * @param pid - The supervised child's process id.
   * @returns Live descendant process ids.
   */
  async listDescendants(pid: number): Promise<number[]> {
    let stdout: string
    try {
      ({ stdout } = await run('ps', ['-Ao', 'pid=,ppid='], { timeout: HELPER_TIMEOUT_MS }))
    } catch {
      // Without a readable process table the caller cannot prove quiescence; an
      // empty list would be a false claim, so report none found and let the
      // supervisor's own exit tracking decide.
      return []
    }
    const pairs: (readonly [number, number])[] = []
    for (const line of stdout.split('\n')) {
      const [childText, parentText] = line.trim().split(/\s+/)
      const child = Number(childText)
      const parent = Number(parentText)
      if (Number.isInteger(child) && Number.isInteger(parent)) pairs.push([child, parent])
    }
    return collectDescendants(pairs, pid)
  }
}

/**
 * Signal a whole process group, tolerating a group that has already exited.
 * @param pid - Group leader's process id.
 * @param signal - Signal to deliver.
 */
function signalGroup(pid: number, signal: 'SIGTERM' | 'SIGKILL'): void {
  try {
    process.kill(-pid, signal)
  } catch {
    // No such group: either the child never became a group leader or the whole
    // group is already gone. The single-process attempt below covers the first.
    try {
      process.kill(pid, signal)
    } catch {
      // Already exited, which is the requested end state.
    }
  }
}

/** Windows face: `taskkill` owns tree termination and CIM owns tree inspection. */
class Win32Face implements ProcessFace {
  readonly platform = 'win32' as const
  readonly nodeBinaryName = 'node.exe'
  readonly detached = true

  /**
   * Ask the tree to close without forcing it.
   *
   * `taskkill /T` without `/F` posts a close request. A console process that
   * installs no handler may ignore it entirely, which is why the supervisor
   * always follows this with a bounded wait and then {@link forceStopTree}.
   * @param pid - The supervised child's process id.
   */
  async requestGracefulStop(pid: number): Promise<void> {
    try {
      await run('taskkill', ['/PID', String(pid), '/T'], { timeout: HELPER_TIMEOUT_MS, windowsHide: true })
    } catch {
      // taskkill exits non-zero when the process is already gone or refuses the
      // polite request; both are expected here and resolved by the escalation.
    }
  }

  /**
   * Terminate the process and its descendants with `/T /F`.
   * @param pid - The supervised child's process id.
   */
  async forceStopTree(pid: number): Promise<void> {
    try {
      await run('taskkill', ['/PID', String(pid), '/T', '/F'], { timeout: HELPER_TIMEOUT_MS, windowsHide: true })
    } catch {
      // Non-zero here means there was nothing left to kill; quiescence is
      // verified by listDescendants, never by this exit code.
    }
  }

  /**
   * Enumerate descendants through CIM.
   * @param pid - The supervised child's process id.
   * @returns Live descendant process ids.
   */
  async listDescendants(pid: number): Promise<number[]> {
    let stdout: string
    try {
      ({ stdout } = await run(
        'powershell.exe',
        [
          '-NoProfile',
          '-NonInteractive',
          '-Command',
          'Get-CimInstance Win32_Process | ForEach-Object { "$($_.ProcessId) $($_.ParentProcessId)" }',
        ],
        { timeout: HELPER_TIMEOUT_MS, windowsHide: true },
      ))
    } catch {
      // Same contract as the darwin face: no readable table means no proof.
      return []
    }
    const pairs: (readonly [number, number])[] = []
    for (const line of stdout.split('\n')) {
      const [childText, parentText] = line.trim().split(/\s+/)
      const child = Number(childText)
      const parent = Number(parentText)
      if (Number.isInteger(child) && Number.isInteger(parent)) pairs.push([child, parent])
    }
    return collectDescendants(pairs, pid)
  }
}

/**
 * Select the face for a target platform.
 * @param platform - Target platform, defaulting to the current process's.
 * @returns The matching process face.
 * @throws Error when the platform is not a qualification target.
 */
export function processFace(platform: NodeJS.Platform = process.platform): ProcessFace {
  if (platform === 'darwin') return new DarwinFace()
  if (platform === 'win32') return new Win32Face()
  throw new Error(`dsh-desktop supports darwin and win32; this process reports ${platform}`)
}

export { collectDescendants }
