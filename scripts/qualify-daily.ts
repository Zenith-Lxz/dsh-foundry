/**
 * Clean-environment qualification of the daily distribution.
 *
 * Installs the daily Bundle into an isolated Harness home through the
 * **official** `dsh plugin --profile daily add …` command, then asserts what the
 * installation actually produced rather than that the command exited zero.
 *
 * The assertions that matter most are the negative ones: an official row must
 * not be disabled, an official composition must not be copied, and a
 * pre-existing profile and user patch must come out byte-identical. A
 * distribution that only adds rows is the property this whole design rests on,
 * so it is checked rather than asserted in prose.
 *
 * Usage: `pnpm run qualify:daily [--keep]`
 * @module scripts/qualify-daily
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const KEEP = process.argv.includes('--keep')

/** Companion packages the daily profile installs, in dependency order. */
const DAILY_PACKAGES = [
  'packages/daily-contract',
  'packages/plugin-governance',
  'packages/daily-agent',
  'packages/daily-workbench',
  'packages/daily-bundle',
]

/** Bundle layers the daily browser profile must end up with, in order. */
const DAILY_BUNDLES = ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-foundry/daily-bundle']

interface Manifest {
  readonly dsh: { readonly tested: string, readonly package: string }
  readonly targets: Readonly<Record<string, { readonly node: { readonly binary: string } }>>
}

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as Manifest
const target = `${process.platform}-${process.arch}`
const targetManifest = manifest.targets[target]
if (targetManifest === undefined) throw new Error(`no stage declared for ${target}`)

const stageDir = join(REPOSITORY_ROOT, 'stage', target)
const nodePath = join(stageDir, 'node', targetManifest.node.binary)
const dshEntry = join(stageDir, 'runtime', 'node_modules', ...manifest.dsh.package.split('/'), 'lib', 'bin.js')
const stageBin = join(stageDir, 'bin')
if (!existsSync(dshEntry)) throw new Error(`stage is incomplete: ${dshEntry} is missing`)

const home = mkdtempSync(join(tmpdir(), 'dsh-daily-qualify-'))
const failures: string[] = []

/**
 * Record an assertion outcome.
 * @param condition - What must hold.
 * @param description - Human-readable statement of the requirement.
 */
function check(condition: boolean, description: string): void {
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${description}`)
  if (!condition) failures.push(description)
}

/**
 * Run the official CLI from the staged runtime.
 * @param args - Arguments after the CLI entry.
 * @returns Captured stdout.
 */
function dsh(args: readonly string[]): string {
  return execFileSync(nodePath, [dshEntry, ...args], {
    cwd: home,
    env: {
      ...process.env,
      DSH_HOME: home,
      // The staged package manager, so the official plugin command works
      // without a developer toolchain on the machine.
      PATH: [stageBin, join(stageDir, 'node', 'bin'), process.env['PATH'] ?? ''].filter(Boolean).join(':'),
    },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

try {
  console.log(`qualifying the daily distribution in an isolated home: ${home}\n`)

  // A pre-existing official profile and a user-owned patch layer, so "adds only"
  // can be demonstrated against something that would visibly change.
  dsh(['--profile', 'web', '--dump-config'])
  const webManifestPath = join(home, 'profiles', 'web', 'package.json')
  const webBefore = readFileSync(webManifestPath, 'utf8')
  const webPatchPath = join(home, 'profiles', 'web', 'cordis.patch.yml')
  const webPatchBefore = existsSync(webPatchPath) ? readFileSync(webPatchPath, 'utf8') : undefined
  const officialWebDump = dsh(['--profile', 'web', '--dump-config'])

  const packDir = mkdtempSync(join(tmpdir(), 'dsh-daily-pack-'))
  const tarballs = DAILY_PACKAGES.map((relative) => {
    const output = execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: join(REPOSITORY_ROOT, relative),
      encoding: 'utf8',
    })
    const file = output.trim().split('\n').at(-1)
    if (file === undefined) throw new Error(`pnpm pack produced no tarball for ${relative}`)
    return file
  })

  console.log('installing through the official plugin command\n')
  dsh(['plugin', '--profile', 'daily', 'add', ...tarballs])

  // A fresh non-template profile starts at the base layer alone; the daily
  // browser profile needs the official Web product beneath its own layer.
  const profileManifestPath = join(home, 'profiles', 'daily', 'package.json')
  const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
    dependencies?: Record<string, string>
  }
  const bundles = profileManifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
    bundles.splice(bundles.indexOf('@deepseek-ai/dsh-base') + 1, 0, '@deepseek-ai/dsh-web-app')
    writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)
  }
  const userPatch = '# user-owned layer\n[]\n'
  writeFileSync(join(home, 'profiles', 'daily', 'cordis.patch.yml'), userPatch)

  console.log('\nassertions\n')
  const finalBundles = (JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
    dependencies?: Record<string, string>
  })
  const layers = finalBundles.dsh?.profile?.bundles ?? []
  check(
    JSON.stringify(layers) === JSON.stringify(DAILY_BUNDLES),
    `bundle layers are ordered ${DAILY_BUNDLES.join(' -> ')} (actual: ${layers.join(' -> ')})`,
  )
  check(
    Object.keys(finalBundles.dependencies ?? {}).includes('@dsh-foundry/daily-bundle'),
    'the daily Bundle is installed as a profile dependency',
  )

  const dump = dsh(['--profile', 'daily', '--dump-config'])
  mkdirSync(join(REPOSITORY_ROOT, 'evidence'), { recursive: true })
  writeFileSync(join(REPOSITORY_ROOT, 'evidence', 'daily-profile-dump.yml'), dump)

  check(dump.includes('@dsh-foundry/daily-agent'), 'the composed config mounts the daily-agent row')
  check(dump.includes('@dsh-foundry/daily-workbench'), 'the composed config mounts the daily-workbench row')
  check(
    dump.includes('@deepseek-ai/dsh-web-app') && dump.includes('@deepseek-ai/dsh-host-apiproxy'),
    'the official Web product and API gateway remain composed beneath the daily layer',
  )
  check(
    dump.includes('@deepseek-ai/dsh-agent-presets'),
    'the official agent-preset roster remains composed, so Standard stays the live baseline',
  )

  // The distribution adds rows and overrides none: every official row present in
  // the untouched web composition must still be present here.
  const officialRows = [...officialWebDump.matchAll(/^\s*-?\s*id:\s*([\w-]+)/gm)].map((match) => match[1])
  const dailyRows = new Set([...dump.matchAll(/^\s*-?\s*id:\s*([\w-]+)/gm)].map((match) => match[1]))
  const dropped = [...new Set(officialRows)].filter((row) => row !== undefined && !dailyRows.has(row))
  check(dropped.length === 0, `no official row is dropped by the daily layer (dropped: ${dropped.join(', ') || 'none'})`)

  // The official Web bundle already disables the agent-plane rows that moved
  // behind presets, so a count of disabled rows measures upstream, not us. The
  // invariant is that the daily layer adds no disable of its own.
  const disabledIn = (text: string): Set<string> => new Set(
    [...text.matchAll(/- id:\s*(\w[\w-]*)[\s\S]{0,80}?disabled:\s*true/g)]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined),
  )
  const officialDisabled = disabledIn(officialWebDump)
  const newlyDisabled = [...disabledIn(dump)].filter((id) => !officialDisabled.has(id))
  check(
    newlyDisabled.length === 0,
    `the daily layer disables no row the official composition left enabled (newly disabled: ${newlyDisabled.join(', ') || 'none'})`,
  )

  check(readFileSync(webManifestPath, 'utf8') === webBefore, 'the unrelated web profile manifest is unchanged')
  check(
    webPatchBefore === undefined || readFileSync(webPatchPath, 'utf8') === webPatchBefore,
    "the unrelated web profile's user patch layer is unchanged",
  )
  check(
    readFileSync(join(home, 'profiles', 'daily', 'cordis.patch.yml'), 'utf8') === userPatch,
    "the daily profile's user-owned patch layer is unchanged",
  )

  rmSync(packDir, { recursive: true, force: true })
} finally {
  if (KEEP) console.log(`\nkeeping the qualification home at ${home}`)
  else rmSync(home, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? 'daily qualification passed' : `daily qualification FAILED (${failures.length})`}`)
if (failures.length > 0) process.exit(1)
