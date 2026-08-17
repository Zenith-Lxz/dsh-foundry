/**
 * Supervisor lifecycle against real child processes.
 *
 * The adapter's other tests exercise parsing and resolution as pure functions.
 * These drive `DshSupervisor` over a **real spawned process**, because the
 * behaviour at issue — one host at a time, the old tree dead before the new one
 * starts, escalation when a child ignores a graceful stop, disposal that leaves
 * nothing behind — is process behaviour, and a mock of `spawn` would only prove
 * the mock.
 *
 * The child is a small Node script standing in for the official CLI. It prints
 * the same readiness line the real host prints and can be told to exit early or
 * to ignore the graceful stop.
 * @module packages/dsh-adapter/tests/supervisor-lifecycle.test
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { DshSupervisor, processFace, type ResolvedRuntime } from '../src/index.ts'

/** Behaviours the stand-in child can be given. */
type ChildMode = 'serve' | 'exit-before-ready' | 'exit-after-ready' | 'ignore-graceful' | 'with-tool'

/**
 * Write a stand-in for the official CLI.
 *
 * It binds a real loopback port so the readiness line carries a port that was
 * genuinely allocated, which is what the supervisor validates.
 * @param mode - How the child should behave.
 * @returns Absolute path of the script.
 */
function childScript(mode: ChildMode): string {
  const root = mkdtempSync(join(tmpdir(), 'supervisor-'))
  const path = join(root, 'fake-dsh.mjs')
  writeFileSync(path, `
import { createServer } from 'node:http'
const mode = ${JSON.stringify(mode)}
if (mode === 'exit-before-ready') { process.stdout.write('starting up\\n'); process.exit(3) }
if (mode === 'ignore-graceful') { process.on('SIGTERM', () => {}); process.on('SIGINT', () => {}) }
if (mode === 'with-tool') {
  // Stands in for a running tool or terminal: a grandchild of the supervised
  // process, which is what quiescence is actually verified against.
  const { spawn } = await import('node:child_process')
  spawn(process.execPath, ['-e', 'setInterval(() => {}, 1 << 30)'], { stdio: 'ignore' })
}
const server = createServer((_request, response) => { response.end('ok') })
server.listen(0, '127.0.0.1', () => {
  const { port } = server.address()
  process.stdout.write('dsh web: http://127.0.0.1:' + port + '\\n')
  if (mode === 'exit-after-ready') { server.close(); process.exit(4) }
})
setInterval(() => {}, 1 << 30)
`)
  return path
}

/**
 * A runtime pointing at the stand-in child rather than the staged CLI.
 * @param mode - How the child should behave.
 * @returns The runtime the supervisor will spawn.
 */
function runtimeFor(mode: ChildMode): ResolvedRuntime {
  return {
    target: `${process.platform}-${process.arch}`,
    nodePath: process.execPath,
    dshEntry: childScript(mode),
    runtimeRoot: tmpdir(),
    dshVersion: '0.1.0-rc.6',
    range: '>=0.1.0-rc.6 <0.2.0',
  }
}

/**
 * Whether a process id is still live.
 * @param pid - Process id.
 * @returns True when the process exists.
 */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH: the process is gone, which is what the caller is asking about.
    return false
  }
}

const supervisors: DshSupervisor[] = []

/**
 * Build a supervisor and register it for teardown.
 * @param mode - How its child should behave.
 * @returns The supervisor.
 */
function supervisorFor(mode: ChildMode): DshSupervisor {
  const supervisor = new DshSupervisor({
    runtime: runtimeFor(mode),
    profile: 'test',
    cwd: tmpdir(),
    face: processFace(process.platform),
  })
  supervisors.push(supervisor)
  return supervisor
}

afterEach(async () => {
  for (const supervisor of supervisors.splice(0)) await supervisor.stop().catch(() => undefined)
})

describe.skipIf(process.platform === 'win32')('one host at a time', () => {
  it('reports a ready origin whose port was really allocated', async () => {
    const supervisor = supervisorFor('serve')
    const { origin, generation } = await supervisor.start()
    expect(generation).toBe(1)
    expect(origin).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/)
    // The origin has to be live, not merely well-formed: a parsed line that
    // points at nothing would send the window to a connection refusal.
    expect(execFileSync('curl', ['-s', '--max-time', '3', origin], { encoding: 'utf8' })).toBe('ok')
  }, 30_000)

  it('kills the old generation before the new one serves', async () => {
    const supervisor = supervisorFor('serve')
    const first = await supervisor.start()
    const readyState = supervisor.state
    expect(readyState.kind).toBe('ready')
    const oldPid = readyState.kind === 'ready' ? readyState.pid : 0

    const second = await supervisor.restart()
    expect(second.generation).toBe(first.generation + 1)
    // Two hosts overlapping would leave the previous origin answering, and a
    // renderer still pointed at it would keep working against a dead generation.
    expect(alive(oldPid)).toBe(false)
    expect(second.origin).not.toBe(first.origin)
    expect(execFileSync('curl', ['-s', '--max-time', '3', second.origin], { encoding: 'utf8' })).toBe('ok')
  }, 60_000)

  it('revokes the old origin, so it stops answering after a restart', async () => {
    const supervisor = supervisorFor('serve')
    const first = await supervisor.start()
    await supervisor.restart()
    const reachedOldOrigin = (() => {
      try {
        execFileSync('curl', ['-sf', '--max-time', '2', first.origin], { encoding: 'utf8' })
        return true
      } catch {
        return false
      }
    })()
    expect(reachedOldOrigin).toBe(false)
  }, 60_000)
})

describe.skipIf(process.platform === 'win32')('a child that does not stay up', () => {
  it('fails the start rather than resolving with no origin', async () => {
    await expect(supervisorFor('exit-before-ready').start()).rejects.toThrow()
  }, 30_000)

  it('classifies an exit that happens after readiness', async () => {
    const supervisor = supervisorFor('exit-after-ready')
    const exited = new Promise<{ generation: number }>((settle) => supervisor.once('exited', settle))
    await supervisor.start()
    const event = await exited
    // The window must learn that its host died; a supervisor that only reports
    // startup would leave a dead origin loaded with no failure surface.
    expect(event.generation).toBe(1)
  }, 30_000)
})

describe.skipIf(process.platform === 'win32')('shutdown is verified, not assumed', () => {
  it('escalates when the child ignores a graceful stop, and reports that it did', async () => {
    const supervisor = supervisorFor('ignore-graceful')
    const { origin } = await supervisor.start()
    expect(origin).toMatch(/^http:/)
    const report = await supervisor.stop()
    expect(report.escalated).toBe(true)
    expect(report.survivingDescendants).toEqual([])
  }, 60_000)

  it('leaves no owned descendant after an ordinary stop', async () => {
    const supervisor = supervisorFor('serve')
    await supervisor.start()
    const report = await supervisor.stop()
    expect(report.escalated).toBe(false)
    expect(report.survivingDescendants).toEqual([])
  }, 30_000)

  it('is idempotent, so a second quit request cannot fail a shutdown', async () => {
    const supervisor = supervisorFor('serve')
    await supervisor.start()
    const [first, second] = await Promise.all([supervisor.stop(), supervisor.stop()])
    expect(first.survivingDescendants).toEqual([])
    expect(second.survivingDescendants).toEqual([])
  }, 30_000)

  it('reports nothing to stop when nothing was started', async () => {
    const report = await supervisorFor('serve').stop()
    expect(report).toEqual({ escalated: false, survivingDescendants: [], durationMs: expect.any(Number) })
  })
})

describe.skipIf(process.platform === 'win32')('an active tool tree is torn down too', () => {
  it('reports the tool as an owned descendant while it runs', async () => {
    const supervisor = supervisorFor('with-tool')
    await supervisor.start()
    // The grandchild is spawned right after the readiness line, so allow the
    // process table a moment to show it rather than racing the assertion.
    let descendants: number[] = []
    for (let attempt = 0; attempt < 40 && descendants.length === 0; attempt += 1) {
      descendants = await supervisor.listDescendants()
      if (descendants.length === 0) await new Promise((settle) => setTimeout(settle, 100))
    }
    expect(descendants.length).toBeGreaterThan(0)
  }, 30_000)

  it('leaves no surviving descendant after quitting with a tool running', async () => {
    const supervisor = supervisorFor('with-tool')
    await supervisor.start()
    let seen: number[] = []
    for (let attempt = 0; attempt < 40 && seen.length === 0; attempt += 1) {
      seen = await supervisor.listDescendants()
      if (seen.length === 0) await new Promise((settle) => setTimeout(settle, 100))
    }
    expect(seen.length).toBeGreaterThan(0)

    const report = await supervisor.stop()
    // Quiescence is verified by enumerating the tree, not assumed from the
    // parent having exited: an orphaned tool keeps holding the workspace.
    expect(report.survivingDescendants).toEqual([])
    for (const pid of seen) expect(alive(pid), `descendant ${pid} survived`).toBe(false)
  }, 60_000)
})
