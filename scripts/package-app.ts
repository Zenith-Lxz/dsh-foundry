/**
 * Produce an unsigned desktop application for one target from its closed
 * production stage.
 *
 * The application source handed to the packager is assembled fresh rather than
 * taken from the workspace directory: a workspace has `node_modules` holding
 * Electron itself and every development dependency, and packaging that would
 * both bloat the artifact and let a development module resolve at runtime.
 * Only the bundled main and preload go in.
 *
 * The stage ships as an unpacked resource, not inside the app archive: it
 * carries a Node executable and native modules, which an archive cannot expose
 * to `spawn`. At runtime the main process resolves it from
 * `process.resourcesPath` and nothing else.
 *
 * The artifact is deliberately unsigned. Signing and notarization are separate
 * changes; a local unsigned build is what the MVP qualifies.
 *
 * Usage: `node --experimental-strip-types scripts/package-app.ts <target>`
 * @module scripts/package-app
 */
import { packager } from '@electron/packager'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Product name; also the `.app` bundle name on macOS. */
const product = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'product.json'), 'utf8')) as {
  name: string
  displayName: string
  bundleId: string
  publisher: string
}
const PRODUCT_NAME = product.displayName
const BUNDLE_ID = product.bundleId

/** Companion packages shipped for first-run profile provisioning. */
const COMPANION_PACKAGES = [
  'packages/desktop-native',
  'packages/desktop-layout',
  'packages/desktop-bundle',
  'packages/daily-contract',
  'packages/plugin-governance',
  'packages/daily-agent',
  'packages/daily-workbench',
  'packages/daily-bundle',
]

interface Manifest {
  readonly companionVersion: string
  readonly electron: { readonly version: string }
  readonly targets: Readonly<Record<string, { readonly platform: string, readonly arch: string }>>
}

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: package-app.ts <target> [--build-candidate]')
  process.exit(2)
}

/**
 * Whether the caller accepts a stage whose native modules were never compiled
 * for the target.
 *
 * Opt-in and explicit. Cross-staging installs modules with `--os --cpu
 * --ignore-scripts`, so nothing is compiled and no postinstall runs; the
 * resulting application launches into failures that look like product defects.
 * The flag exists so a Windows host can be handed something to test, never so
 * an incomplete artifact can be produced by accident.
 */
const buildCandidate = process.argv.includes('--build-candidate')

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as Manifest
const targetManifest = manifest.targets[target]
if (targetManifest === undefined) {
  console.error(`unknown target ${target}; known: ${Object.keys(manifest.targets).join(', ')}`)
  process.exit(2)
}

/**
 * Generated application icon, named without its extension.
 *
 * electron-packager appends the per-platform extension itself (`.icns` on
 * macOS, `.ico` on Windows); passing the full filename makes it look for
 * `icon.icns.icns` and silently fall back to Electron's own icon with only a
 * warning. Absent until `pnpm run build:icon` has run.
 */
const ICON_BASE = join(REPOSITORY_ROOT, 'assets', 'icon')

// Said out loud rather than silently falling back: the icon is generated, so a
// fresh clone has none, and a build that quietly ships Electron's own icon looks
// like the product's icon simply regressed.
const hasIcon = existsSync(`${ICON_BASE}.icns`)
if (!hasIcon) {
  console.warn('WARNING: assets/icon.icns is missing; run `pnpm run build:icon` first, '
    + "or this build ships Electron's default icon.")
}

const stageDir = join(REPOSITORY_ROOT, 'stage', target)
const stageDescriptorPath = join(stageDir, 'stage.json')
if (!existsSync(stageDescriptorPath)) {
  throw new Error(`no production stage for ${target}; run the staging step for this target first`)
}
const stageDescriptor = JSON.parse(readFileSync(stageDescriptorPath, 'utf8')) as { nativeComplete: boolean }

// An incomplete stage was previously reported and then packaged anyway: the
// value was printed into the log and never consulted. That produces a release-
// shaped artifact whose native modules do not exist for the target, which is
// indistinguishable from an accepted build once it leaves this machine.
if (!stageDescriptor.nativeComplete && !buildCandidate) {
  throw new Error(
    `the ${target} stage reports nativeComplete: false — its native modules were never compiled for this target, `
    + 'so the packaged application would fail at run time in ways that look like product defects.\n'
    + `Run the staging step on a real ${targetManifest.platform} host, or pass --build-candidate to produce a `
    + 'clearly-labelled artifact for testing on one.',
  )
}

const mainBundle = join(REPOSITORY_ROOT, 'apps', 'desktop', 'lib', 'main', 'index.cjs')
const preloadBundle = join(REPOSITORY_ROOT, 'apps', 'desktop', 'lib', 'preload', 'index.cjs')
for (const required of [mainBundle, preloadBundle]) {
  if (!existsSync(required)) throw new Error(`missing build output at ${required}; run the bundle step first`)
}

// Assemble the application source: the two bundles and a minimal manifest.
const releaseRoot = join(REPOSITORY_ROOT, 'release')
const appSource = join(releaseRoot, `${target}-app-source`)
rmSync(appSource, { recursive: true, force: true })
mkdirSync(join(appSource, 'lib'), { recursive: true })
cpSync(join(REPOSITORY_ROOT, 'apps', 'desktop', 'lib'), join(appSource, 'lib'), { recursive: true })
writeFileSync(
  join(appSource, 'package.json'),
  `${JSON.stringify(
    {
      name: product.name,
      productName: PRODUCT_NAME,
      version: manifest.companionVersion,
      main: 'lib/main/index.cjs',
      // Windows packaging refuses without an author: it becomes the
      // CompanyName in the executable's version resource. macOS does not need
      // it, which is why every build before the first Windows one passed.
      author: product.publisher,
      private: true,
    },
    null,
    2,
  )}\n`,
)

// The companion packages ship as tarballs so first-run provisioning can hand
// them to the official `dsh plugin` command exactly as an external consumer
// would, with no network access and no developer toolchain on the machine.
const companionsDir = join(releaseRoot, `${target}-companions`)
rmSync(companionsDir, { recursive: true, force: true })
mkdirSync(companionsDir, { recursive: true })
for (const relative of COMPANION_PACKAGES) {
  execFileSync('pnpm', ['pack', '--pack-destination', companionsDir], {
    cwd: join(REPOSITORY_ROOT, relative),
    stdio: 'pipe',
  })
}
console.log(`packed ${readdirSync(companionsDir).length} companion packages`)

// A build candidate names itself. Someone who receives the directory has no
// other way to tell it apart from an accepted build.
const outputDir = join(releaseRoot, stageDescriptor.nativeComplete ? target : `${target}-build-candidate`)
rmSync(outputDir, { recursive: true, force: true })

console.log(`packaging ${PRODUCT_NAME} for ${target} (stage nativeComplete: ${stageDescriptor.nativeComplete})`)

const [artifact] = await packager({
  dir: appSource,
  out: outputDir,
  platform: targetManifest.platform,
  arch: targetManifest.arch,
  electronVersion: manifest.electron.version,
  appVersion: manifest.companionVersion,
  name: PRODUCT_NAME,
  appBundleId: BUNDLE_ID,
  // Omitting this ships Electron's own icon, which is what every build before
  // this one did. The `.icns` is generated from `assets/icon.svg` by
  // `pnpm run build:icon`; see `assets/README.md` for its provenance.
  ...(hasIcon ? { icon: ICON_BASE } : {}),
  overwrite: true,
  asar: true,
  // Unsigned by design for the MVP; signing and notarization are separate work.
  osxSign: false,
  // The stage lands beside the app archive in Resources/, which is where the
  // main process looks when `app.isPackaged` is true.
  extraResource: [stageDir, companionsDir, join(REPOSITORY_ROOT, 'compatibility.json')],
  quiet: false,
})

if (artifact === undefined) throw new Error('the packager produced no artifact')

// The stage arrives under its own target name; the runtime expects
// `<resources>/stage/<target>`, so the resource is re-seated once here rather
// than teaching the resolver a second layout.
const resourcesDir = targetManifest.platform === 'darwin'
  ? join(artifact, `${PRODUCT_NAME}.app`, 'Contents', 'Resources')
  : join(artifact, 'resources')
const stagedTargetDir = join(resourcesDir, target)
const stageParent = join(resourcesDir, 'stage')
if (existsSync(stagedTargetDir)) {
  mkdirSync(stageParent, { recursive: true })
  cpSync(stagedTargetDir, join(stageParent, target), { recursive: true })
  rmSync(stagedTargetDir, { recursive: true, force: true })
}
// Same re-seating for the companions, which arrive under their build-directory
// name: the runtime looks for `<resources>/companions`.
const stagedCompanions = join(resourcesDir, `${target}-companions`)
if (existsSync(stagedCompanions)) renameSync(stagedCompanions, join(resourcesDir, 'companions'))

rmSync(appSource, { recursive: true, force: true })
rmSync(companionsDir, { recursive: true, force: true })

console.log(`\npackaged: ${artifact}`)
if (!stageDescriptor.nativeComplete) {
  console.warn(
    `WARNING: the ${target} stage is not native-complete (cross-staged). `
    + 'This artifact is a build candidate and is NOT acceptance evidence for that platform.',
  )
}
