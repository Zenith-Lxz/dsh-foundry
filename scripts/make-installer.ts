/**
 * `pnpm run installer <target>` — build a one-click installer.
 *
 * A packaged directory is not something to hand a user: the executable is a
 * quarter of it, and the staged runtime, the official DSH release, and this
 * distribution's companion tarballs sit beside it. This produces the artifact
 * each platform expects instead:
 *
 * - **macOS**: a `.dmg` whose window holds the application beside a link to
 *   `/Applications`, which is the platform's install gesture.
 * - **Windows**: an NSIS installer that installs per user under
 *   `%LOCALAPPDATA%`, so the whole flow is one click with no administrator
 *   prompt, and that registers an uninstaller in Add/Remove Programs.
 *
 * electron-builder wraps the **already-packaged** directory rather than
 * replacing `package-app.ts`. Packaging owns the staged runtime, the companion
 * tarballs, and the incomplete-stage guard; moving those into installer
 * configuration would put them beyond every test that currently covers them.
 *
 * Neither artifact is signed. macOS Gatekeeper quarantines the `.dmg` and
 * Windows SmartScreen warns about the `.exe`; that is stated here and in the
 * release notes rather than discovered by whoever runs it.
 * @module scripts/make-installer
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))
const CONFIG = join(REPOSITORY_ROOT, 'scripts', 'installer', 'electron-builder.yml')
const OUTPUT_DIR = join(REPOSITORY_ROOT, 'release', 'installer')

/** Installer artifacts, as opposed to the metadata electron-builder writes beside them. */
const INSTALLER_SUFFIXES = ['.exe', '.dmg'] as const

/**
 * Report an artifact's size and digest.
 * @param path - Artifact path.
 */
function describe(path: string): void {
  const bytes = statSync(path).size
  const digest = createHash('sha256').update(readFileSync(path)).digest('hex')
  console.log(`\ninstaller: ${basename(path)}`)
  console.log(`  size:   ${(bytes / (1024 * 1024)).toFixed(1)} MiB`)
  console.log(`  sha256: ${digest}`)
}

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: make-installer.ts <target>   e.g. darwin-arm64 | win32-x64-build-candidate')
  process.exit(2)
}

const product = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'product.json'), 'utf8')) as {
  displayName: string
}
const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as {
  electron: { version: string }
}

const releaseRoot = join(REPOSITORY_ROOT, 'release', target)
if (!existsSync(releaseRoot)) {
  console.error(`no packaged output at release/${target}; package that target first`)
  process.exit(2)
}
const [packagedName] = readdirSync(releaseRoot).filter((entry) =>
  statSync(join(releaseRoot, entry)).isDirectory())
if (packagedName === undefined) {
  console.error(`release/${target} contains no packaged directory`)
  process.exit(2)
}
const packaged = join(releaseRoot, packagedName)

const forWindows = target.startsWith('win32')

// What `--prepackaged` should point at differs by platform, and getting it
// wrong is silent: a macOS image built from the containing directory opens to
// show that directory beside the Applications link, so the drag gesture the
// whole layout exists for has nothing to drag.
const prepackaged = forWindows ? packaged : join(packaged, `${product.displayName}.app`)
if (!existsSync(prepackaged)) {
  console.error(`expected ${basename(prepackaged)} inside release/${target}`)
  process.exit(2)
}

const before = existsSync(OUTPUT_DIR) ? new Set(readdirSync(OUTPUT_DIR)) : new Set<string>()

console.log(`building the ${forWindows ? 'Windows installer' : 'macOS disk image'} from release/${target}…`)
execFileSync('npx', [
  'electron-builder',
  '--prepackaged', prepackaged,
  forWindows ? '--win' : '--mac',
  '--x64',
  '--config', CONFIG,
  // The packaged tree carries no Electron dependency of its own, so the version
  // it was built against is stated rather than inferred from node_modules.
  '--config.electronVersion', manifest.electron.version,
], { cwd: REPOSITORY_ROOT, stdio: 'inherit' })

const produced = readdirSync(OUTPUT_DIR)
  .filter((entry) => !before.has(entry))
  .filter((entry) => INSTALLER_SUFFIXES.some((suffix) => entry.endsWith(suffix)))
if (produced.length === 0) {
  console.error('electron-builder produced no installer')
  process.exit(1)
}
for (const entry of produced) describe(join(OUTPUT_DIR, entry))

if (forWindows) {
  console.log(`\n  One click, per user, into %LOCALAPPDATA% — no administrator prompt.`)
  console.log('  Unsigned: SmartScreen warns on first run. "More info" -> "Run anyway".')
} else {
  console.log(`\n  Open it and drag ${product.displayName} onto Applications.`)
  console.log('  Unsigned: Gatekeeper quarantines it. Right-click -> Open on first launch.')
}
