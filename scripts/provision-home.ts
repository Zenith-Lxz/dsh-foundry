/**
 * Provision a Harness home carrying the desktop profile.
 *
 * Used by development runs and packaged smokes: it performs the same official
 * `dsh plugin --profile desktop add …` installation the qualification lane
 * asserts, but into a durable directory so a launched application has real
 * state to work against.
 *
 * Usage: `node --experimental-strip-types scripts/provision-home.ts <home-dir>`
 * @module scripts/provision-home
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

const home = process.argv[2]
if (home === undefined) {
  console.error('usage: provision-home.ts <home-dir>')
  process.exit(2)
}

interface Manifest {
  readonly dsh: { readonly package: string }
  readonly profile: { readonly name: string, readonly bundles: readonly string[], readonly companionPackages: readonly string[] }
  readonly targets: Readonly<Record<string, { readonly node: { readonly binary: string } }>>
}

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as Manifest
const target = `${process.platform}-${process.arch}`
const targetManifest = manifest.targets[target]
if (targetManifest === undefined) throw new Error(`no stage declared for ${target}`)

const stageDir = join(REPOSITORY_ROOT, 'stage', target)
const nodePath = join(stageDir, 'node', targetManifest.node.binary)
const dshEntry = join(stageDir, 'runtime', 'node_modules', ...manifest.dsh.package.split('/'), 'lib', 'bin.js')
if (!existsSync(dshEntry)) throw new Error(`stage is incomplete: ${dshEntry} is missing`)

mkdirSync(home, { recursive: true })

const packDir = mkdtempSync(join(tmpdir(), 'dsh-desktop-pack-'))
const tarballs = ['packages/desktop-native', 'packages/desktop-layout', 'packages/desktop-bundle'].map((relative) => {
  const output = execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: join(REPOSITORY_ROOT, relative),
    encoding: 'utf8',
  })
  const file = output.trim().split('\n').at(-1)
  if (file === undefined) throw new Error(`pnpm pack produced no tarball for ${relative}`)
  return file
})

execFileSync(nodePath, [dshEntry, 'plugin', '--profile', manifest.profile.name, 'add', ...tarballs], {
  cwd: home,
  env: { ...process.env, DSH_HOME: home },
  stdio: 'inherit',
})

// A fresh non-template profile starts at dsh-base only; the desktop surface
// needs the official Web product seated beneath the companion layer.
const profileManifestPath = join(home, 'profiles', manifest.profile.name, 'package.json')
const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
  dsh?: { profile?: { bundles?: string[] } }
}
const bundles = profileManifest.dsh?.profile?.bundles ?? []
if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
  bundles.splice(bundles.indexOf('@deepseek-ai/dsh-base') + 1, 0, '@deepseek-ai/dsh-web-app')
  writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)
}

rmSync(packDir, { recursive: true, force: true })
console.log(`provisioned ${manifest.profile.name} profile in ${home}`)
console.log(`bundle layers: ${bundles.join(' -> ')}`)
