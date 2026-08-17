/**
 * The Electron companion shell.
 *
 * Startup runs one ordered state machine:
 *
 * ```text
 * single-instance -> runtime-resolved -> host-starting -> origin-validated
 *   -> renderer-loading -> ready
 * ```
 *
 * Shutdown runs the reverse, and the first quit owns it:
 *
 * ```text
 * stop-native-ingress -> revoke-renderer -> close-window -> request-host-stop
 *   -> await-owned-tree -> bounded-escalation-if-needed -> quit
 * ```
 *
 * The window loads exactly one origin — the one the owned DSH child reported
 * ready — and business traffic goes straight to it over the official transport.
 * Electron never proxies, buffers, or retries that traffic.
 * @module @dsh-foundry/app/main
 */
import { app, BrowserWindow, nativeTheme, shell, type WebContents } from 'electron'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  DshSupervisor,
  readCompatibilityManifest,
  resolveRuntime,
  RuntimeResolutionError,
  targetKey,
  redact,
  type ResolvedRuntime,
} from '@dsh-foundry/adapter'
import {
  DESKTOP_BRIDGE_VERSION,
  DESKTOP_OPERATIONS,
  type DesktopCapabilitiesV1,
  type DesktopPlatform,
} from '@dsh-foundry/contract'
import { broadcastWindowState, installBridge } from './bridge.ts'
import { ensureDesktopProfile, fingerprintCompanions, harnessHome } from './provision.ts'
import { failureSurface, loadingSurface } from './surfaces.ts'

/** Minimum usable window width; below this the conversation and tool surfaces stop being usable. */
const MIN_WIDTH = 720
const MIN_HEIGHT = 520

const HERE = dirname(fileURLToPath(import.meta.url))

/**
 * Where the production stage and compatibility manifest live.
 *
 * A packaged application resolves them from its own bundle resources and
 * nothing else — the stage is deliberately kept outside the app archive because
 * it holds executables and native modules the archive cannot expose. A source
 * run resolves them from the repository instead.
 *
 * The environment overrides exist for the qualification lanes, which point a
 * source run at a specific stage. They are read once here so no other module
 * has an opinion about where the runtime comes from.
 */
const { stageRoot: STAGE_ROOT, manifestPath: MANIFEST_PATH, companionsDir: COMPANIONS_DIR } = resolveProductionPaths()

/**
 * Resolve the stage root and manifest path for this launch.
 * @returns Absolute paths to the stage root, the compatibility manifest, and the bundled companion packages.
 */
function resolveProductionPaths(): { stageRoot: string, manifestPath: string, companionsDir: string } {
  const root = app.isPackaged
    ? process.resourcesPath
    : join(HERE, '..', '..', '..', '..')
  return {
    stageRoot: process.env['DSH_DESKTOP_STAGE_ROOT'] ?? join(root, 'stage'),
    manifestPath: process.env['DSH_DESKTOP_MANIFEST'] ?? join(root, 'compatibility.json'),
    companionsDir: process.env['DSH_DESKTOP_COMPANIONS'] ?? join(root, 'companions'),
  }
}

let window: BrowserWindow | undefined
let supervisor: DshSupervisor | undefined
let runtime: ResolvedRuntime | undefined
let disposeBridge: (() => void) | undefined
let disposeWindowState: (() => void) | undefined
/** Set once the ordered quit sequence begins; later quit requests join it. */
let quitting: Promise<void> | undefined
/** Origin currently authorized for the renderer; cleared the moment the host is not ready. */
let authorizedOrigin: string | undefined

if (!app.requestSingleInstanceLock()) {
  // A second launch for this user-data directory must not start another host.
  app.exit(0)
} else {
  app.on('second-instance', () => {
    focusPrimaryWindow()
  })
  void main()
}

/** Resolve the runtime, start the host, and present the window. */
async function main(): Promise<void> {
  await app.whenReady()

  app.on('window-all-closed', () => {
    void requestQuit()
  })
  app.on('activate', () => {
    // macOS: reactivating with no window recreates it against the running host
    // rather than starting a second one.
    if (BrowserWindow.getAllWindows().length === 0 && quitting === undefined) void createWindow()
  })
  app.on('before-quit', (event) => {
    if (quitting === undefined) {
      event.preventDefault()
      void requestQuit()
    }
  })
  // Default-deny every permission request; the desktop surface asks for none.
  app.on('web-contents-created', (_event, contents) => {
    hardenWebContents(contents)
  })

  await createWindow()
  await startHost()
}

/** Create the primary window with the full security posture. */
async function createWindow(): Promise<void> {
  const created = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: MIN_WIDTH,
    minHeight: MIN_HEIGHT,
    show: false,
    // The window's own paint shows before the renderer draws and around the
    // frame during a resize. A fixed light value flashes white on a dark
    // system, so it follows the operating system's current appearance.
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1115' : '#fbfbfd',
    // Both platforms hide the native caption so the desktop layout owns the
    // title area, but neither emulates the other: macOS keeps the operating
    // system's own traffic lights inset over the frame, while Windows hides the
    // caption entirely and the layout renders its own controls. `hidden` rather
    // than `frame: false` on Windows keeps the native resize borders and snap
    // behavior, which a frameless window loses.
    ...(process.platform === 'darwin'
      ? { titleBarStyle: 'hiddenInset' as const, trafficLightPosition: { x: 18, y: 12 } }
      : { titleBarStyle: 'hidden' as const }),
    webPreferences: {
      preload: join(HERE, '..', 'preload', 'index.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      nodeIntegrationInWorker: false,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      spellcheck: false,
    },
  })
  window = created
  disposeWindowState = broadcastWindowState(created)
  created.once('ready-to-show', () => created.show())
  created.on('closed', () => {
    disposeWindowState?.()
    disposeWindowState = undefined
    window = undefined
  })
  await loadInWindow(loadingSurface())

  disposeBridge = installBridge({
    window: () => window,
    origin: () => authorizedOrigin,
    generation: () => supervisor?.generation ?? 0,
    capabilities: describeCapabilities,
    diagnostic: (line) => {
      console.warn(`[dsh-foundry] ${redact(line)}`)
    },
  })
}

/**
 * Apply the navigation and permission policy to every `webContents`.
 * @param contents - Newly created web contents.
 */
function hardenWebContents(contents: WebContents): void {
  contents.setWindowOpenHandler(({ url }) => {
    // The trusted document never opens application windows. A validated
    // external link goes to the operating system with no bridge access.
    openExternalIfAllowed(url)
    return { action: 'deny' }
  })
  contents.on('will-navigate', (event, url) => {
    if (authorizedOrigin === undefined || safeOrigin(url) !== authorizedOrigin) {
      event.preventDefault()
      openExternalIfAllowed(url)
    }
  })
  contents.on('will-attach-webview', (event) => {
    // No webview is part of this product; attaching one would create a document
    // outside the origin policy above.
    event.preventDefault()
  })
  // A preload that throws leaves the renderer with no bridge and no visible
  // cause: the failure lands in the renderer's console, which the main log
  // never sees. Surfacing it here is what makes a broken bridge diagnosable.
  contents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`[dsh-foundry] preload failed at ${preloadPath}: ${redact(error.message)}`)
  })
  contents.session.setPermissionRequestHandler((_wc, _permission, callback) => {
    callback(false)
  })
  contents.session.setPermissionCheckHandler(() => false)
}

/**
 * Open a URL externally when its scheme is allowed.
 * @param url - Candidate URL.
 */
function openExternalIfAllowed(url: string): void {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') void shell.openExternal(url)
  } catch {
    // A malformed target is simply not opened; nothing else consumes it.
  }
}

/** Resolve the staged runtime and start the supervised host, presenting failures. */
async function startHost(): Promise<void> {
  const manifest = readCompatibilityManifest(MANIFEST_PATH)
  try {
    runtime = resolveRuntime({ stageRoot: STAGE_ROOT, manifest })
  } catch (error) {
    await showFailure(
      { zh: '无法启动受支持的运行时', en: 'Cannot start a supported runtime' },
      error instanceof RuntimeResolutionError
        ? error.message
        : `${targetKey()}: ${error instanceof Error ? error.message : String(error)}`,
    )
    return
  }

  // First launch on a machine has no desktop profile. Creating it is part of
  // starting, not a separate setup the user performs.
  try {
    const outcome = await ensureDesktopProfile({
      runtime,
      companionsDir: COMPANIONS_DIR,
      profile: manifest.profile.name,
      supersededScopes: manifest.profile.supersededScopes ?? [],
      bundles: manifest.profile.bundles,
      bundlePackage: manifest.profile.bundle,
      companionFingerprint: fingerprintCompanions(COMPANIONS_DIR),
      companionVersion: manifest.companionVersion,
    })
    if (outcome.kind === 'installed') {
      console.log(`[dsh-foundry] provisioned the ${manifest.profile.name} profile in ${harnessHome()}`)
    }
  } catch (error) {
    await showFailure(
      { zh: '无法准备桌面 Profile', en: 'Cannot prepare the desktop profile' },
      error instanceof Error ? error.message : String(error),
    )
    return
  }

  const created = new DshSupervisor({
    runtime,
    profile: manifest.profile.name,
    cwd: app.getPath('home'),
  })
  supervisor = created
  created.on('exited', ({ classification }) => {
    // The renderer's authority dies with the host that granted it, before any
    // replacement can load.
    authorizedOrigin = undefined
    if (quitting !== undefined) return
    void showFailure(
      { zh: '本地运行时已退出', en: 'The local runtime exited' },
      `classification: ${classification.kind}`
      + ('tail' in classification ? `\n${classification.tail.join('\n')}` : ''),
    )
  })

  try {
    const { origin } = await created.start()
    authorizedOrigin = origin
    // Logged because readiness had no observable signal, and a smoke test that
    // cannot see it falls back to "a process exists and a port listens" — which
    // is what let a release that showed a failure surface report success.
    console.log('[dsh-foundry] host ready')
    if (!await loadInWindow(origin)) {
      // The origin refused the connection: the host reported ready and then
      // died, so the exit handler owns the surface rather than a stale load.
      authorizedOrigin = undefined
    } else {
      console.log('[dsh-foundry] renderer loaded the Harness interface')
    }
  } catch (error) {
    authorizedOrigin = undefined
    const tail = (error as { tail?: readonly string[] }).tail
    await showFailure(
      { zh: '本地运行时启动失败', en: 'The local runtime failed to start' },
      [
        error instanceof Error ? error.message : String(error),
        ...(tail ?? []),
      ].join('\n'),
    )
  }
}

/**
 * Replace the window contents with the failure surface.
 * @param headline - Bilingual headline pair.
 * @param detail - Bounded diagnostic detail.
 */
async function showFailure(headline: { zh: string, en: string }, detail: string): Promise<void> {
  await loadInWindow(failureSurface(headline, redact(detail)))
}

/**
 * Load a URL into the primary window, tolerating the two ordinary races.
 *
 * `loadURL` rejects when a newer load supersedes it (`ERR_ABORTED`) and when
 * the target refuses the connection — both happen legitimately here: a host
 * that exits while its origin is loading produces the second, and a failure
 * surface replacing an in-flight load produces the first. Neither is a
 * programming error, and neither may become an unhandled rejection.
 * @param url - Target URL.
 * @returns True when the load completed, false when it was superseded or refused.
 */
async function loadInWindow(url: string): Promise<boolean> {
  const target = window
  if (target === undefined || target.isDestroyed()) return false
  try {
    await target.loadURL(url)
    return true
  } catch (error) {
    console.warn(`[dsh-foundry] load did not complete: ${redact(error instanceof Error ? error.message : String(error))}`)
    return false
  }
}

/** Restore and focus the primary window for a second launch. */
function focusPrimaryWindow(): void {
  if (window === undefined || window.isDestroyed()) return
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
}

/**
 * Run the ordered quit sequence exactly once.
 *
 * Later quit requests await the same promise instead of interleaving a second
 * escalation against the same process tree.
 * @returns Resolves when the application has quit.
 */
async function requestQuit(): Promise<void> {
  if (quitting !== undefined) return quitting
  quitting = (async () => {
    // 1. stop native ingress
    disposeBridge?.()
    disposeBridge = undefined
    // 2. revoke renderer authority
    authorizedOrigin = undefined
    // 3. close the window
    disposeWindowState?.()
    disposeWindowState = undefined
    if (window !== undefined && !window.isDestroyed()) window.destroy()
    window = undefined
    // 4-6. request host stop, await the owned tree, escalate only if needed
    if (supervisor !== undefined) {
      const report = await supervisor.stop()
      console.log(
        `[dsh-foundry] shutdown ${report.escalated ? 'escalated' : 'clean'} in ${report.durationMs}ms; `
        + `surviving owned descendants: ${report.survivingDescendants.length}`,
      )
    }
    // 7. quit
    app.exit(0)
  })()
  return quitting
}

/**
 * Build the immutable capability description for this build.
 * @returns The capabilities the bridge serves.
 */
function describeCapabilities(): DesktopCapabilitiesV1 {
  const platform = process.platform === 'win32' ? 'win32' : 'darwin'
  return {
    bridgeVersion: DESKTOP_BRIDGE_VERSION,
    platform: platform satisfies DesktopPlatform,
    arch: process.arch,
    appVersion: app.getVersion(),
    dshVersion: runtime?.dshVersion ?? 'unknown',
    electronVersion: process.versions['electron'] ?? 'unknown',
    operations: [...DESKTOP_OPERATIONS],
    windowControls: platform === 'darwin' ? 'macos-traffic-lights' : 'windows-caption',
    pathSeparator: platform === 'win32' ? '\\' : '/',
  }
}

/**
 * Parse an origin without throwing.
 * @param url - Candidate URL.
 * @returns The origin, or `undefined` when unparsable.
 */
function safeOrigin(url: string): string | undefined {
  try {
    return new URL(url).origin
  } catch {
    // Unparsable navigation targets are denied by the caller.
    return undefined
  }
}
