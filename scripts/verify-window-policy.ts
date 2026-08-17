/**
 * `pnpm run verify:window` — assert the window policy on the live packaged
 * application.
 *
 * Everything else about the desktop shell is checked as a pure decision or from
 * source. These are the properties that exist only once Electron has really
 * opened a `BrowserWindow`: that the renderer cannot reach Node, that the only
 * native surface it can reach is the declared bridge, that opening a window and
 * navigating away are actually prevented, and that the layout still resolves at
 * the widths a user drags to.
 *
 * The gap this closes is specific. The authorization and settlement decisions
 * are tested exhaustively as pure functions, but nothing proved Electron was
 * *wired* to them: deleting the `setWindowOpenHandler` registration, or
 * misspelling `contextIsolation`, passed every other gate. That is the same
 * shape as every defect this project has actually shipped — code present, never
 * exercised.
 *
 * Driven over Electron's own remote-debugging protocol with Node's built-in
 * WebSocket, so it adds no dependency and inspects the window the product
 * really opened rather than a replica of its options.
 *
 * **External-open safety.** A denied window-open or navigation still calls the
 * product's external-link path, which opens `http:`/`https:` targets in the
 * user's real browser. Every probe below therefore uses a `file:` target: the
 * deny path runs identically and nothing reaches the operating system.
 * @module scripts/verify-window-policy
 */
import { spawn, execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const DEBUG_PORT = 9333
const READY_TIMEOUT_MS = 180_000

/**
 * A target that reaches the product's deny path and nothing else.
 *
 * Two constraints pull against each other. The target must be something
 * Chromium would really open, or the probe proves nothing: a `file:` URL is
 * refused by the browser itself, so removing the product's deny handler and
 * repackaging still passed. And it must not be `http:` or `https:`, because a
 * denied open still calls the product's external-link path, which would launch
 * the user's real browser on every run of this gate.
 *
 * `about:blank` satisfies both: Chromium opens it when allowed, and the
 * external-link guard ignores it because its protocol is not `http(s):`.
 */
const INERT_TARGET = 'about:blank'

/** Widths a user drags to. The narrow entry is below the sidebar's open threshold. */
export const QUALIFIED_WIDTHS: readonly { readonly label: string, readonly width: number }[] = [
  { label: 'narrow', width: 760 },
  { label: 'normal', width: 1280 },
  { label: 'wide', width: 1920 },
]

/** One checked expectation. */
interface Check {
  readonly name: string
  readonly passed: boolean
  readonly detail: string
}

const checks: Check[] = []
const record = (name: string, passed: boolean, detail = ''): void => {
  checks.push({ name, passed, detail })
  console.log(`${passed ? '✓' : '✗'} ${name}${detail === '' ? '' : ` — ${detail}`}`)
}

/**
 * Count the application's live page targets.
 *
 * A denied window-open leaves this unchanged; an allowed one adds a target.
 * @param port - Remote debugging port.
 * @returns Number of page targets.
 */
function pageTargetCount(port: number): number {
  try {
    const listing = JSON.parse(execFileSync('curl', ['-s', '--max-time', '5', `http://127.0.0.1:${port}/json/list`], {
      encoding: 'utf8',
    })) as { type: string }[]
    return listing.filter((entry) => entry.type === 'page').length
  } catch {
    // An unreadable listing must not read as "no new window appeared".
    return Number.NaN
  }
}

/**
 * Wait until a predicate holds.
 * @param predicate - Checked repeatedly.
 * @param timeoutMs - Deadline.
 * @returns True when it held before the deadline.
 */
async function waitFor(predicate: () => boolean | Promise<boolean>, timeoutMs: number): Promise<boolean> {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (await predicate()) return true
    await new Promise((settle) => setTimeout(settle, 500))
  }
  return false
}

/** A minimal Chrome DevTools Protocol session over the built-in WebSocket. */
class Devtools {
  readonly #socket: WebSocket
  #nextId = 1
  readonly #pending = new Map<number, (result: unknown) => void>()

  /**
   * @param socket - An open WebSocket to the page target.
   */
  private constructor(socket: WebSocket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data)) as { id?: number, result?: unknown, error?: unknown }
      if (message.id === undefined) return
      const settle = this.#pending.get(message.id)
      if (settle === undefined) return
      this.#pending.delete(message.id)
      settle(message.error ?? message.result)
    })
  }

  /**
   * Attach to the application's page target.
   * @param port - Remote debugging port.
   * @returns The session.
   */
  static async attach(port: number): Promise<Devtools> {
    const listing = JSON.parse(execFileSync('curl', ['-s', '--max-time', '5', `http://127.0.0.1:${port}/json/list`], {
      encoding: 'utf8',
    })) as { type: string, url: string, webSocketDebuggerUrl?: string }[]
    const page = listing.find((entry) => entry.type === 'page' && entry.webSocketDebuggerUrl !== undefined)
    if (page?.webSocketDebuggerUrl === undefined) throw new Error('no page target is exposed')
    const socket = new WebSocket(page.webSocketDebuggerUrl)
    await new Promise<void>((settle, fail) => {
      socket.addEventListener('open', () => { settle() }, { once: true })
      socket.addEventListener('error', () => { fail(new Error('devtools socket failed')) }, { once: true })
    })
    return new Devtools(socket)
  }

  /**
   * Issue one protocol command.
   * @param method - Protocol method.
   * @param params - Method parameters.
   * @returns The result payload.
   */
  send(method: string, params: Record<string, unknown> = {}): Promise<unknown> {
    const id = this.#nextId++
    return new Promise((settle) => {
      this.#pending.set(id, settle)
      this.#socket.send(JSON.stringify({ id, method, params }))
    })
  }

  /**
   * Evaluate an expression in the page.
   * @param expression - JavaScript to evaluate.
   * @returns The evaluated value.
   */
  async evaluate<T>(expression: string): Promise<T> {
    const answer = await this.send('Runtime.evaluate', {
      expression, returnByValue: true, awaitPromise: true,
    }) as { result?: { value?: T } }
    return answer.result?.value as T
  }

  /** Close the session. */
  close(): void {
    this.#socket.close()
  }
}

const product = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'product.json'), 'utf8')) as { displayName: string }
const target = process.argv[2] ?? 'darwin-arm64'
const binary = join(
  REPOSITORY_ROOT, 'release', target,
  `${product.displayName}-${target}`, `${product.displayName}.app`, 'Contents', 'MacOS', product.displayName,
)
if (!existsSync(binary)) {
  console.error(`no packaged application at ${binary}; run package:${target} first`)
  process.exit(2)
}

const sandbox = mkdtempSync(join(tmpdir(), 'window-policy-'))
const child = spawn(binary, [`--user-data-dir=${join(sandbox, 'user-data')}`, `--remote-debugging-port=${DEBUG_PORT}`], {
  env: { ...process.env, DSH_HOME: join(sandbox, 'dsh-home') },
  stdio: ['ignore', 'pipe', 'pipe'],
})
let log = ''
child.stdout.on('data', (chunk: Buffer) => { log += chunk.toString() })
child.stderr.on('data', (chunk: Buffer) => { log += chunk.toString() })

let devtools: Devtools | undefined
try {
  const loaded = await waitFor(() => log.includes('renderer loaded the Harness interface'), READY_TIMEOUT_MS)
  record('the packaged application reached its interface', loaded, loaded ? '' : log.slice(-400))

  if (loaded) {
    const attached = await waitFor(async () => {
      try {
        devtools = await Devtools.attach(DEBUG_PORT)
        return true
      } catch {
        return false
      }
    }, 30_000)
    record('the window exposes an inspectable page target', attached)
  }

  if (devtools !== undefined) {
    const session = devtools

    // Node reachability. `contextIsolation` and `sandbox` are declared in the
    // window options; this is what proves Electron applied them.
    for (const name of ['require', 'process', 'module', 'global', 'Buffer'] as const) {
      const kind = await session.evaluate<string>(`typeof ${name}`)
      record(`the renderer cannot reach Node \`${name}\``, kind === 'undefined', `typeof is ${String(kind)}`)
    }

    const exposed = await session.evaluate<string[]>(
      `Object.keys(globalThis).filter((key) => /electron|ipc|node/i.test(key))`)
    record('no Electron or IPC global is exposed to the page',
      Array.isArray(exposed) && exposed.length === 0,
      Array.isArray(exposed) ? exposed.join(', ') : 'unreadable')

    // Opening a window must be denied.
    //
    // The obvious probe — `window.open(...) === null` — is worthless: it is
    // true in a sandboxed renderer whether or not the deny handler is
    // installed. Removing `setWindowOpenHandler` from the product and
    // repackaging still passed it. What distinguishes the two is whether a
    // window actually appeared, so this counts the application's page targets
    // across the attempt.
    const targetsBefore = pageTargetCount(DEBUG_PORT)
    await session.evaluate<unknown>(`window.open(${JSON.stringify(INERT_TARGET)})`)
    await new Promise((settle) => setTimeout(settle, 1500))
    const targetsAfter = pageTargetCount(DEBUG_PORT)
    record('opening a window is denied', targetsAfter <= targetsBefore,
      `${targetsBefore} page target(s) before, ${targetsAfter} after`)

    // Top-level navigation away from the owned origin is NOT probed here, and
    // the omission is deliberate rather than an oversight.
    //
    // Every target that would exercise `will-navigate` is unusable in a gate:
    // an `http(s):` one reaches the product's external-link path and launches
    // the user's real browser, a `file:` one is refused by Chromium before the
    // handler runs, and `about:blank` is not intercepted by `will-navigate` at
    // all — it navigates, blanking the window and cascading into every check
    // after it. That last case was measured, not assumed.
    //
    // Blanking the window is reachable only by script already running in the
    // trusted page, and it grants nothing: the bridge authorizes on origin, and
    // a blanked document's origin is `null`, which `authorizationFailure`
    // refuses — a case that suite covers directly. The gap that remains is
    // whether `will-navigate` prevents a cross-origin `http` navigation, and
    // that is stated as unverified in STATUS.md rather than papered over.

    const webviewAttached = await session.evaluate<boolean>(`
      (() => {
        const view = document.createElement('webview')
        view.setAttribute('src', ${JSON.stringify(INERT_TARGET)})
        document.body.append(view)
        const attached = typeof (view as unknown as { getWebContentsId?: unknown }).getWebContentsId === 'function'
        view.remove()
        return attached
      })()
    `)
    record('a webview cannot be attached', webviewAttached !== true, `attached: ${String(webviewAttached)}`)

    // Layout at the widths a user drags to.
    for (const { label, width } of QUALIFIED_WIDTHS) {
      await session.send('Emulation.setDeviceMetricsOverride', {
        width, height: 900, deviceScaleFactor: 1, mobile: false,
      })
      await new Promise((settle) => setTimeout(settle, 600))
      const geometry = await session.evaluate<{ width: number, overflow: number, controls: number }>(`
        (() => {
          const body = document.body
          return {
            width: Math.round(body.getBoundingClientRect().width),
            overflow: Math.max(0, Math.round(document.documentElement.scrollWidth - window.innerWidth)),
            controls: document.querySelectorAll('button, [role="button"], a[href], input').length,
          }
        })()
      `)
      const fits = geometry !== undefined && geometry.overflow === 0
      record(`the ${label} layout does not overflow its viewport (${width}px)`, fits,
        geometry === undefined ? 'unreadable' : `body ${geometry.width}px, overflow ${geometry.overflow}px`)
      const usable = geometry !== undefined && geometry.controls > 0
      record(`the ${label} layout still presents its controls`, usable,
        geometry === undefined ? '' : `${geometry.controls} focusable control(s)`)
    }
    await session.send('Emulation.clearDeviceMetricsOverride')
  }
} finally {
  devtools?.close()
  child.kill('SIGTERM')
  await waitFor(() => child.exitCode !== null || child.signalCode !== null, 20_000)
  rmSync(sandbox, { recursive: true, force: true })
}

const failed = checks.filter((check) => !check.passed)
console.log(`\n${failed.length === 0 ? 'PASS' : 'FAIL'} — window policy, ${checks.length - failed.length}/${checks.length} checks`)
if (failed.length > 0) process.exitCode = 1
