/**
 * Build one closed production stage: an official Node runtime plus the exact
 * published `@deepseek-ai/dsh` dependency closure, verified and self-contained.
 *
 * ```text
 * stage/<target>/
 *   node/                     official Node build, checksum-verified
 *   runtime/node_modules/     the published DSH closure for this target
 *   stage.json                what was staged, from where, and whether it is native-complete
 * ```
 *
 * A stage is native-complete only when it was built on a host of its own target:
 * the closure contains modules compiled from source (`node-pty`, the subprocess
 * spawn helper), and those cannot be produced for a foreign target by
 * downloading a different architecture's JavaScript. A foreign-target stage is
 * therefore written with `nativeComplete: false` and is a build candidate, not
 * an acceptable runtime.
 *
 * Usage: `node --experimental-strip-types scripts/stage-runtime.ts <target>`
 * @module scripts/stage-runtime
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, readdirSync, renameSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const STAGE_ROOT = join(REPOSITORY_ROOT, 'stage')
const NODE_DIST = 'https://nodejs.org/dist'

/**
 * Install scripts approved for the staged closure.
 *
 * Reviewed individually: each builds or fetches a native artifact the Harness
 * genuinely needs. Blanket approval (`--dangerously-allow-all-scripts`) is not
 * used, so a new script-bearing transitive dependency fails staging loudly
 * instead of executing unreviewed.
 */
const APPROVED_INSTALL_SCRIPTS = [
  '@deepseek-ai/dsh-subprocess-local',
  'node-pty',
  'koffi',
  'protobufjs',
  '@google/genai',
]

interface TargetManifest {
  readonly platform: string
  readonly arch: string
  readonly node: { readonly version: string, readonly artifact: string, readonly sha256: string, readonly binary: string }
}

interface Manifest {
  readonly dsh: { readonly tested: string, readonly package: string }
  readonly packageManager: { readonly name: string, readonly version: string }
  readonly targets: Readonly<Record<string, TargetManifest>>
}

const target = process.argv[2]
if (target === undefined) {
  console.error('usage: stage-runtime.ts <target>')
  process.exit(2)
}

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as Manifest
const targetManifest = manifest.targets[target]
if (targetManifest === undefined) {
  console.error(`unknown target ${target}; known: ${Object.keys(manifest.targets).join(', ')}`)
  process.exit(2)
}

const isNativeHost = targetManifest.platform === process.platform && targetManifest.arch === process.arch
const stageDir = join(STAGE_ROOT, target)

console.log(`staging ${target} (native host: ${isNativeHost})`)
rmSync(stageDir, { recursive: true, force: true })
mkdirSync(stageDir, { recursive: true })

stageNode(targetManifest, stageDir)
stageRuntime(manifest, targetManifest, stageDir, isNativeHost)
stagePackageManager(manifest, stageDir)

writeFileSync(
  join(stageDir, 'stage.json'),
  `${JSON.stringify(
    {
      target,
      stagedAt: new Date().toISOString(),
      stagedOn: `${process.platform}-${process.arch}`,
      node: targetManifest.node,
      dsh: { package: manifest.dsh.package, version: manifest.dsh.tested },
      approvedInstallScripts: APPROVED_INSTALL_SCRIPTS,
      nativeComplete: isNativeHost,
      note: isNativeHost
        ? 'Built on a host of this target; native modules are compiled for it.'
        : 'Cross-staged from another host. Native modules are NOT built for this target: '
          + 'this is a build candidate and must be re-staged on a real host of this target before acceptance.',
    },
    null,
    2,
  )}\n`,
)

console.log(`staged ${target} at ${stageDir} (nativeComplete: ${isNativeHost})`)
if (!isNativeHost) {
  console.warn(
    `WARNING: ${target} was cross-staged from ${process.platform}-${process.arch}. `
    + 'Native modules are not built for it. Re-stage on a real host of this target before acceptance.',
  )
}

/**
 * Download, verify, and extract the official Node build for a target.
 * @param targetManifest - The target's pinned Node artifact and checksum.
 * @param stageDir - Destination stage directory.
 */
function stageNode(targetManifest: TargetManifest, stageDir: string): void {
  const { version, artifact, sha256 } = targetManifest.node
  const url = `${NODE_DIST}/v${version}/${artifact}`
  const cacheDir = join(STAGE_ROOT, '.cache')
  mkdirSync(cacheDir, { recursive: true })
  const archivePath = join(cacheDir, artifact)

  if (!existsSync(archivePath)) {
    console.log(`downloading ${url}`)
    execFileSync('curl', ['-fsSL', '--retry', '3', '-o', archivePath, url], { stdio: 'inherit' })
  }

  const actual = createHash('sha256').update(readFileSync(archivePath)).digest('hex')
  if (actual !== sha256) {
    rmSync(archivePath, { force: true })
    throw new Error(`checksum mismatch for ${artifact}\n  expected ${sha256}\n  actual   ${actual}`)
  }
  console.log(`verified ${artifact} sha256 ${actual}`)

  const nodeDir = join(stageDir, 'node')
  mkdirSync(nodeDir, { recursive: true })
  // `tar` handles both formats on both hosts (macOS and Windows both ship
  // bsdtar, which reads zip). `unzip` is deliberately not used: it is absent on
  // a stock Windows host, which would break staging on the very platform whose
  // stage must be built there to be native-complete.
  if (artifact.endsWith('.tar.xz')) {
    execFileSync('tar', ['-xJf', archivePath, '-C', nodeDir, '--strip-components=1'], { stdio: 'inherit' })
  } else if (artifact.endsWith('.zip')) {
    // bsdtar rejects --strip-components on zip, so the nested top-level
    // directory is flattened afterwards instead.
    execFileSync('tar', ['-xf', archivePath, '-C', nodeDir], { stdio: 'inherit' })
    const [nested] = readdirSync(nodeDir)
    if (nested !== undefined && existsSync(join(nodeDir, nested, 'node.exe'))) {
      for (const entry of readdirSync(join(nodeDir, nested))) {
        renameSync(join(nodeDir, nested, entry), join(nodeDir, entry))
      }
      rmSync(join(nodeDir, nested), { recursive: true, force: true })
    }
  } else {
    throw new Error(`unsupported Node artifact format: ${artifact}`)
  }

  const binary = join(nodeDir, targetManifest.node.binary)
  if (!existsSync(binary)) throw new Error(`extracted Node is missing its declared binary at ${binary}`)
  console.log(`extracted Node ${version} to ${nodeDir}`)
}

/**
 * Install the exact published DSH closure into the stage.
 * @param manifest - Compatibility manifest naming the package and tested version.
 * @param targetManifest - The target being staged.
 * @param stageDir - Destination stage directory.
 * @param isNativeHost - Whether this host matches the target being staged.
 */
function stageRuntime(
  manifest: Manifest,
  targetManifest: TargetManifest,
  stageDir: string,
  isNativeHost: boolean,
): void {
  const runtimeDir = join(stageDir, 'runtime')
  mkdirSync(runtimeDir, { recursive: true })
  // npm rejects --allow-scripts for a project-scoped install and requires the
  // approval to be declared, which makes the reviewed allowlist an artifact of
  // the stage rather than an invocation detail. The field is a map of package
  // name (or name@version) to a boolean, not a list.
  const allowScripts: Record<string, boolean> = {}
  for (const approved of APPROVED_INSTALL_SCRIPTS) allowScripts[approved] = true
  writeFileSync(
    join(runtimeDir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-desktop-stage', private: true, version: '0.0.0', allowScripts }, null, 2)}\n`,
  )

  const specifier = `${manifest.dsh.package}@${manifest.dsh.tested}`
  const args = ['install', specifier, '--no-audit', '--no-fund', '--install-strategy=hoisted', '--save-exact']
  if (!isNativeHost) {
    // npm can select platform-specific OPTIONAL dependencies for a foreign
    // target, which is enough to assemble a candidate closure. It cannot
    // compile from source for that target, which is why the stage is marked
    // nativeComplete: false above.
    args.push(`--os=${targetManifest.platform}`, `--cpu=${targetManifest.arch}`, '--ignore-scripts')
  }

  console.log(`installing ${specifier} into ${runtimeDir}`)
  execFileSync('npm', args, { cwd: runtimeDir, stdio: 'inherit' })

  const entry = join(runtimeDir, 'node_modules', ...manifest.dsh.package.split('/'), 'lib', 'bin.js')
  if (!existsSync(entry)) throw new Error(`staged closure is missing the official CLI entry at ${entry}`)
  console.log(`installed ${specifier}`)
}

/**
 * Stage the package manager the official `dsh plugin` command forwards to.
 *
 * `dsh plugin` spawns `pnpm` from `PATH` and exits 127 when it is absent. An
 * application launched from the desktop inherits a minimal `PATH` that will not
 * contain a developer's package manager, so first-run profile provisioning
 * would fail on any machine that does not already develop with pnpm.
 *
 * Staging it keeps the official command in the loop — the alternative,
 * writing the profile directly, would bypass the very command the installation
 * contract is defined in terms of.
 *
 * The shims are plain launchers over the staged Node so the whole path stays
 * inside the stage, with no global executable and no network access at run time.
 * @param manifest - Compatibility manifest naming the pinned package manager.
 * @param stageDir - Destination stage directory.
 */
function stagePackageManager(manifest: Manifest, stageDir: string): void {
  const toolsDir = join(stageDir, 'tools')
  mkdirSync(toolsDir, { recursive: true })
  writeFileSync(
    join(toolsDir, 'package.json'),
    `${JSON.stringify({ name: 'dsh-desktop-stage-tools', private: true, version: '0.0.0' }, null, 2)}\n`,
  )
  const specifier = `${manifest.packageManager.name}@${manifest.packageManager.version}`
  console.log(`installing ${specifier} into ${toolsDir}`)
  execFileSync('npm', ['install', specifier, '--no-audit', '--no-fund', '--save-exact', '--ignore-scripts'], {
    cwd: toolsDir,
    stdio: 'inherit',
  })

  const entry = join(toolsDir, 'node_modules', 'pnpm', 'bin', 'pnpm.cjs')
  if (!existsSync(entry)) throw new Error(`staged package manager is missing its entry at ${entry}`)

  // Both shims are written on every host: the Windows stage is assembled on
  // whichever machine builds it, and a stage missing its own launcher is not
  // self-contained regardless of where it was produced.
  const binDir = join(stageDir, 'bin')
  mkdirSync(binDir, { recursive: true })
  const posixShim = join(binDir, 'pnpm')
  writeFileSync(
    posixShim,
    '#!/bin/sh\n'
    + '# Launcher for the staged package manager, over the staged Node runtime.\n'
    + 'DIR=$(cd "$(dirname "$0")" && pwd)\n'
    + 'exec "$DIR/../node/bin/node" "$DIR/../tools/node_modules/pnpm/bin/pnpm.cjs" "$@"\n',
  )
  chmodSync(posixShim, 0o755)
  writeFileSync(
    join(binDir, 'pnpm.cmd'),
    '@echo off\r\n'
    + 'rem Launcher for the staged package manager, over the staged Node runtime.\r\n'
    + '"%~dp0..\\node\\node.exe" "%~dp0..\\tools\\node_modules\\pnpm\\bin\\pnpm.cjs" %*\r\n',
  )
  console.log(`staged ${specifier} with launchers in ${binDir}`)
}
