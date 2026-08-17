/**
 * `pnpm run smoke:app` — launch the final `.app` and prove it reaches a usable
 * interface.
 *
 * The previous release passed every workspace check and still died at first
 * launch. The gap was what "passing" meant: provisioning succeeded, a process
 * existed, and a port listened, so the smoke reported success while the window
 * showed a runtime-failure surface. A process that is alive is not a product
 * that works.
 *
 * This drives the packaged bundle instead:
 *
 * - two launches: a fresh `DSH_HOME`, and one seeded with a *previous
 *   release's* profile, because a clean-home-only smoke passes while an
 *   upgraded profile fails — which is exactly what happened after the rename,
 *   when a stale bundle layer named a package the new build no longer installs
 *   and the host exited before reporting readiness,
 * - the binary inside the `.app`, never a source launch,
 * - readiness judged by the host reporting ready and the renderer loading the
 *   Harness origin, not by a PID,
 * - shutdown judged by owned descendants reaching zero without touching
 *   processes this run did not start.
 * @module scripts/smoke-packaged-app
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** How long to wait for the window to reach the Harness interface. */
const READY_TIMEOUT_MS = 120_000

/** How long to wait for every owned process to exit after a quit request. */
const SHUTDOWN_TIMEOUT_MS = 20_000

/** Wire namespace the workbench Host publishes under. */
const WORKBENCH_NAMESPACE = 'dshWorkbench'

/**
 * Remote methods called against the live application.
 *
 * `listPlugins` takes no session, so it is checked for a **successful** answer:
 * one complete round trip through claim, dispatch, invocation, and result
 * decoding.
 *
 * `findPaths` is session-scoped, and the smoke starts no session. It is checked
 * for a specific *rejection* instead: `session-not-found` is produced by the
 * official session lookup, which only runs after the Gateway has claimed the
 * endpoint and built a descriptor for it. That distinguishes the two states
 * this check exists for — a claimed endpoint reaching the session layer, versus
 * the bare `not found` of an endpoint the Gateway never claimed at all, which
 * is how the workbench shipped with both halves present and every call failing.
 * It does not prove a workspace read succeeds; the `@file` and review paths are
 * covered by the package suites and by interactive acceptance.
 */
const REMOTE_PROBES: readonly {
  readonly method: string
  readonly args: Record<string, unknown>
  readonly expect: 'ok' | { readonly errorCode: string }
  readonly establishes: string
}[] = [
  {
    method: 'listPlugins',
    args: {},
    expect: 'ok',
    establishes: 'a complete round trip: claimed, dispatched, invoked, and decoded',
  },
  {
    method: 'findPaths',
    args: { sessionId: 'session-smoke-absent' },
    expect: { errorCode: 'session-not-found' },
    establishes: 'the endpoint is claimed and reaches the official session lookup',
  },
]

/** One checked expectation and what it established. */
export interface SmokeStep {
  readonly name: string
  readonly passed: boolean
  readonly detail: string
}

/**
 * Read the process ids descended from a root pid.
 *
 * Only descendants are collected, so a failure to shut down can never be
 * reported by killing something this run did not start.
 * @param root - Root process id.
 * @returns Descendant process ids, excluding the root.
 */
export function ownedDescendants(root: number): number[] {
  const listing = execFileSync('ps', ['-eo', 'pid,ppid'], { encoding: 'utf8' })
  const children = new Map<number, number[]>()
  for (const line of listing.trim().split('\n').slice(1)) {
    const [pid, parent] = line.trim().split(/\s+/).map(Number)
    if (pid === undefined || parent === undefined) continue
    children.set(parent, [...(children.get(parent) ?? []), pid])
  }
  const found: number[] = []
  const walk = (pid: number): void => {
    for (const child of children.get(pid) ?? []) {
      found.push(child)
      walk(child)
    }
  }
  walk(root)
  return found
}

/**
 * Whether a listening port belongs to the launched application's process tree.
 * @param root - Root process id of the launched application.
 * @param port - Listening port to attribute.
 * @returns True when a descendant of `root` holds the port.
 */
function ownsPort(root: number | undefined, port: string): boolean {
  if (root === undefined) return false
  const owned = new Set([root, ...ownedDescendants(root)])
  try {
    const holders = execFileSync('bash', ['-c', `lsof -nP -iTCP:${port} -sTCP:LISTEN -t 2>/dev/null`], {
      encoding: 'utf8',
    }).trim().split('\n').map(Number)
    return holders.some((pid) => owned.has(pid))
  } catch {
    // No holder resolved; treating that as "not ours" keeps a foreign server
    // from being adopted.
    return false
  }
}

/**
 * Wait until a predicate holds or the deadline passes.
 * @param predicate - Checked repeatedly.
 * @param timeoutMs - Deadline.
 * @param intervalMs - Poll interval.
 * @returns True when the predicate held before the deadline.
 */
async function waitFor(
  predicate: () => boolean,
  timeoutMs: number,
  intervalMs = 500,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolveTimer) => setTimeout(resolveTimer, intervalMs))
  }
  return predicate()
}

const product = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'product.json'), 'utf8')) as {
  displayName: string
}
const target = process.argv[2] ?? 'darwin-arm64'
const appPath = join(
  REPOSITORY_ROOT,
  'release',
  target,
  `${product.displayName}-${target}`,
  `${product.displayName}.app`,
)
const binary = join(appPath, 'Contents', 'MacOS', product.displayName)

const steps: SmokeStep[] = []
const record = (name: string, passed: boolean, detail: string): void => {
  steps.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

if (!existsSync(binary)) {
  record('packaged binary exists', false, `${binary} is missing; run package:${target} first`)
  console.log('\nFAIL')
  process.exit(1)
}
record('packaged binary exists', true, appPath.slice(REPOSITORY_ROOT.length + 1))

/**
 * Seed a home with a profile from a previous release.
 *
 * The stale layer is the whole point: it names a package this build does not
 * install, which is the shape a rename leaves behind in a real user's home.
 * @param home - Harness home to seed.
 */
function seedPreviousRelease(home: string): void {
  const profileDir = join(home, 'profiles', 'desktop')
  const stale = '@dsh-desktop/bundle'
  const staleDir = join(profileDir, 'node_modules', ...stale.split('/'))
  execFileSync('mkdir', ['-p', staleDir])
  // The stale package is installed, not merely named. A fixture that seeds the
  // layer alone passes on a build that still fails the real upgrade, because
  // "drop layers whose package is missing" keeps a layer whose package is
  // present — which is exactly how this fixture first reported a false pass.
  writeFileSync(join(staleDir, 'package.json'), `${JSON.stringify({
    name: stale,
    version: '0.1.0',
    dsh: { bundle: { patch: [] } },
  }, null, 2)}\n`)
  writeFileSync(join(profileDir, 'package.json'), `${JSON.stringify({
    name: 'dsh-profile-desktop',
    dependencies: { [stale]: '0.1.0' },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', stale] } },
  }, null, 2)}\n`)
}

// Every launch surface is fresh, so a pass cannot come from a profile a
// previous run left behind.
const sandbox = mkdtempSync(join(tmpdir(), 'foundry-smoke-'))
const home = join(sandbox, 'dsh-home')
const userData = join(sandbox, 'electron-user-data')
const workspace = join(sandbox, 'workspace')
for (const directory of [home, userData, workspace]) {
  execFileSync('mkdir', ['-p', directory])
}
writeFileSync(join(workspace, 'README.md'), '# smoke workspace\n')

const logPath = join(sandbox, 'app.log')
let log = ''
const child = spawn(binary, [`--user-data-dir=${userData}`], {
  cwd: workspace,
  env: { ...process.env, DSH_HOME: home },
  stdio: ['ignore', 'pipe', 'pipe'],
})
const append = (chunk: Buffer): void => {
  log += chunk.toString()
  writeFileSync(logPath, log)
}
child.stdout.on('data', append)
child.stderr.on('data', append)

let exited = false
child.on('exit', () => {
  exited = true
})

const provisioned = await waitFor(() => log.includes('provisioned the desktop profile'), READY_TIMEOUT_MS)
record('profile provisioning succeeded', provisioned, provisioned ? '' : 'no provisioning line appeared')

// The line the shell prints only after the host reports readiness. Waiting on a
// listening port instead is what let a failing release pass: the port belongs
// to Electron, not to a healthy Harness.
const hostReady = await waitFor(() => log.includes('host ready') || log.includes('renderer loaded'), READY_TIMEOUT_MS)
record('DSH host reported ready', hostReady, hostReady ? '' : 'no readiness line appeared')

const failureSurface = /runtime failed to start|ERR_MODULE_NOT_FOUND|Cannot find module|exited before reporting readiness/i
const failure = failureSurface.exec(log)
record('no runtime failure surface', failure === null, failure === null ? '' : failure[0])
record('process still running', !exited, exited ? 'the application exited on its own' : '')

const descendantsBefore = child.pid === undefined ? [] : ownedDescendants(child.pid)
record('owned descendants started', descendantsBefore.length > 0, `${descendantsBefore.length} descendant(s)`)

// Every package that declares a browser half must actually be served one. The
// runtime serves a client bundle only for loader entries with a live fiber, so
// a plugin whose Host half never activates disappears from the page silently —
// no error, no failed check, just a missing feature. Reading the served bundle
// is the only signal that distinguishes "shipped" from "reaching the user".
const uiPort = await (async (): Promise<string | undefined> => {
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    const listening = execFileSync('bash', ['-c',
      "lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | awk '{print $9}' | sed 's/.*://' | sort -un"],
    { encoding: 'utf8' }).trim().split('\n')
    for (const port of listening) {
      try {
        const body = execFileSync('curl', ['-s', '--max-time', '1', `http://127.0.0.1:${port}/`], { encoding: 'utf8' })
        // Any Harness on the machine answers with a boot manifest, including a
        // leftover profile server from an earlier run. Matching the first one
        // found reported this application's packages as missing when they were
        // simply absent from someone else's profile, so the port must belong to
        // a descendant of the process this smoke started.
        if (body.includes('__DSH_BOOT__') && ownsPort(child.pid, port)) return port
      } catch {
        // Not an HTTP listener, or not answering yet.
      }
    }
    await new Promise((settle) => setTimeout(settle, 1000))
  }
  return undefined
})()

record('the Harness interface is being served', uiPort !== undefined, uiPort === undefined ? 'no port served __DSH_BOOT__' : `port ${uiPort}`)

if (uiPort !== undefined) {
  const clientPackages = readdirSync(join(REPOSITORY_ROOT, 'packages'))
    .map((name) => join(REPOSITORY_ROOT, 'packages', name, 'package.json'))
    .filter((path) => existsSync(path))
    .map((path) => JSON.parse(readFileSync(path, 'utf8')) as { name?: string, dsh?: { client?: unknown } })
    .filter((manifest) => manifest.dsh?.client !== undefined && manifest.name !== undefined)
    .map((manifest) => manifest.name!)

  for (const packageName of clientPackages) {
    const status = execFileSync('curl', [
      '-s', '-o', '/dev/null', '-w', '%{http_code}', '--max-time', '3',
      `http://127.0.0.1:${uiPort}/plugins/${packageName}/client.js`,
    ], { encoding: 'utf8' }).trim()
    record(
      `${packageName} reaches the page`,
      status === '200',
      status === '200' ? '' : `the runtime serves no client bundle for it (HTTP ${status}); see docs/open-defects/0001`,
    )
  }

  // A served client bundle proves the plugin loaded, not that the capability it
  // calls answers. The workbench shipped with both halves present and every
  // method rejecting: first because a duplicated `dsh-typert-protocol` held the
  // `@Remote` markers the Gateway reads, so the endpoint was never claimed at
  // all; then because a `#private` field is unreachable through the Cordis
  // service proxy the Gateway invokes on. Neither is visible from the outside —
  // the browser's only symptom was `@` opening no menu — so the smoke calls the
  // capability over the official transport, exactly as the page does.
  for (const probe of REMOTE_PROBES) {
    const endpoint = `${WORKBENCH_NAMESPACE}/${probe.method}`
    const body = execFileSync('curl', [
      '-s', '--max-time', '10', '-X', 'POST',
      '-H', 'content-type: application/json',
      '-d', JSON.stringify({
        type: 'client-request',
        rpcId: `smoke-${probe.method}`,
        method: endpoint,
        payload: { args: probe.args },
      }),
      `http://127.0.0.1:${uiPort}/api/${endpoint}`,
    ], { encoding: 'utf8' })
    let passed = false
    let detail = body.slice(0, 240)
    try {
      const parsed = JSON.parse(body) as {
        result?: { ok?: boolean, error?: { code?: string, message?: string } }
      }
      if (probe.expect === 'ok') {
        passed = parsed.result?.ok === true
        if (!passed) detail = parsed.result?.error?.message ?? detail
      } else {
        passed = parsed.result?.ok === false && parsed.result.error?.code === probe.expect.errorCode
        if (!passed) {
          detail = `expected ${probe.expect.errorCode}, got `
            + `${parsed.result?.ok === true ? 'success' : parsed.result?.error?.code ?? 'no code'}`
        }
      }
    } catch {
      // `not found` is the Gateway's answer for an endpoint no active Remote
      // exports, and it is plain text rather than an envelope — the exact
      // symptom of a Remote whose decorator markers the Gateway cannot see.
      detail = `the Gateway does not export ${endpoint}: ${detail}`
    }
    record(`${endpoint} over the official transport — ${probe.establishes}`, passed, passed ? '' : detail)
  }
}

// A second launch against the same user-data directory must focus the first
// window, not start a second Harness host. Two hosts would each own a profile
// directory and a port, and the second would quietly win the interface while
// the first kept running — checked here against the real artifact because the
// lock is Electron's, not this project's to unit-test.
{
  const descendantsBeforeSecond = child.pid === undefined ? [] : ownedDescendants(child.pid)
  const second = spawn(binary, [`--user-data-dir=${userData}`], {
    env: { ...process.env, DSH_HOME: home },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  let secondExited = false
  second.on('exit', () => { secondExited = true })
  const secondQuit = await waitFor(() => secondExited, 30_000)
  record('a second launch exits instead of starting another host', secondQuit,
    secondQuit ? '' : 'the second instance was still running after 30s')
  if (!secondQuit) second.kill('SIGKILL')
  const descendantsAfterSecond = child.pid === undefined ? [] : ownedDescendants(child.pid)
  record('the first instance keeps exactly one owned host',
    descendantsAfterSecond.length === descendantsBeforeSecond.length,
    `${descendantsBeforeSecond.length} before, ${descendantsAfterSecond.length} after`)
}

child.kill('SIGTERM')
const closed = await waitFor(() => exited, SHUTDOWN_TIMEOUT_MS)
record('application exited on request', closed, closed ? '' : 'still running after SIGTERM')

const leftover = descendantsBefore.filter((pid) => {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    // ESRCH: the process is gone, which is the outcome being checked.
    return false
  }
})
record('owned descendants reached zero', leftover.length === 0, leftover.length === 0 ? '' : `${leftover.join(', ')} survived`)

// Electron holds a single-instance lock; a second launch while the first is
// still tearing down exits immediately and would report the upgrade path as
// broken when nothing was tested. Wait for the whole tree to be gone first.
await waitFor(() => descendantsBefore.every((pid) => {
  try {
    process.kill(pid, 0)
    return false
  } catch {
    return true
  }
}), SHUTDOWN_TIMEOUT_MS)
await new Promise((settle) => setTimeout(settle, 3000))

// Second launch: the upgrade path. A clean home cannot show whether a profile
// left by an earlier release still composes.
const upgradeSandbox = mkdtempSync(join(tmpdir(), 'foundry-upgrade-'))
const upgradeHome = join(upgradeSandbox, 'dsh-home')
execFileSync('mkdir', ['-p', join(upgradeSandbox, 'workspace')])
seedPreviousRelease(upgradeHome)

let upgradeLog = ''
const upgrade = spawn(binary, [`--user-data-dir=${join(upgradeSandbox, 'user-data')}`], {
  cwd: join(upgradeSandbox, 'workspace'),
  env: { ...process.env, DSH_HOME: upgradeHome },
  stdio: ['ignore', 'pipe', 'pipe'],
})
upgrade.stdout.on('data', (chunk: Buffer) => { upgradeLog += chunk.toString() })
upgrade.stderr.on('data', (chunk: Buffer) => { upgradeLog += chunk.toString() })

const upgradeReady = await waitFor(
  () => upgradeLog.includes('host ready') || upgradeLog.includes('renderer loaded'),
  READY_TIMEOUT_MS,
)
record('a profile from a previous release still launches', upgradeReady,
  upgradeReady ? '' : 'the upgraded profile did not reach readiness')
record('the stale bundle layer was dropped', upgradeLog.includes('dropping bundle layer'),
  upgradeLog.includes('dropping bundle layer') ? '' : 'no layer was dropped; the profile may still name a missing package')
record('no runtime failure surface on upgrade', !failureSurface.test(upgradeLog), '')
upgrade.kill('SIGTERM')
await waitFor(() => upgrade.exitCode !== null, SHUTDOWN_TIMEOUT_MS)
if (steps.every((step) => step.passed)) rmSync(upgradeSandbox, { recursive: true, force: true })
else writeFileSync(join(upgradeSandbox, 'upgrade.log'), upgradeLog)

const passed = steps.every((step) => step.passed)
if (!passed) {
  console.log(`\nlog: ${logPath}`)
  console.log(log.split('\n').slice(-25).join('\n'))
} else {
  rmSync(sandbox, { recursive: true, force: true })
}
console.log(`\n${passed ? 'PASS' : 'FAIL'} — packaged ${target} smoke, ${steps.filter((step) => step.passed).length}/${steps.length} checks`)
if (!passed) process.exitCode = 1
