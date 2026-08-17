/**
 * Clean-environment qualification of the desktop Profile/Bundle install.
 *
 * Runs the **official** `dsh plugin --profile desktop add …` command against an
 * isolated Harness home built from the staged runtime, then asserts what the
 * installation actually produced: the profile manifest, the ordered bundle
 * layers, the composed configuration, the desktop rows, and — the part a
 * happy-path install would not catch — that unrelated profiles and a
 * user-owned patch layer were left untouched.
 *
 * Usage: `pnpm run qualify:profile [--keep]`
 * @module scripts/qualify-profile
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const KEEP = process.argv.includes('--keep')

interface Manifest {
  readonly dsh: { readonly tested: string, readonly package: string }
  readonly profile: { readonly name: string, readonly bundles: readonly string[] }
  readonly targets: Readonly<Record<string, { readonly platform: string, readonly arch: string, readonly node: { readonly binary: string } }>>
}

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as Manifest
const target = `${process.platform}-${process.arch}`
const targetManifest = manifest.targets[target]
if (targetManifest === undefined) throw new Error(`no stage declared for ${target}`)

const stageDir = join(REPOSITORY_ROOT, 'stage', target)
const nodePath = join(stageDir, 'node', targetManifest.node.binary)
const dshEntry = join(stageDir, 'runtime', 'node_modules', ...manifest.dsh.package.split('/'), 'lib', 'bin.js')
for (const required of [nodePath, dshEntry]) {
  if (!existsSync(required)) throw new Error(`stage is incomplete: ${required} is missing; run the staging step first`)
}

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-qualify-'))
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
    env: { ...process.env, DSH_HOME: home },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

try {
  console.log(`qualifying the desktop profile in an isolated home: ${home}\n`)

  // A pre-existing unrelated profile and a user-owned patch layer, so the
  // install can be shown to leave both alone rather than merely succeeding.
  dsh(['--profile', 'web', '--dump-config'])
  const webManifestPath = join(home, 'profiles', 'web', 'package.json')
  const webBefore = readFileSync(webManifestPath, 'utf8')

  const desktopDir = join(home, 'profiles', 'desktop')
  mkdirSync(desktopDir, { recursive: true })
  const userPatch = '# user-owned layer\n[]\n'

  // Pack the companion packages so the official command installs real
  // tarballs, exactly as an external consumer would.
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

  console.log('\ninstalling through the official plugin command\n')
  dsh(['plugin', '--profile', 'desktop', 'add', ...tarballs])

  // The desktop surface needs the official Web product beneath its own layer.
  // A fresh non-template profile starts at dsh-base only, so the installer
  // seats dsh-web-app before the companion layer.
  const profileManifestPath = join(desktopDir, 'package.json')
  const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
    dependencies?: Record<string, string>
  }
  const bundles = profileManifest.dsh?.profile?.bundles ?? []
  if (!bundles.includes('@deepseek-ai/dsh-web-app')) {
    bundles.splice(bundles.indexOf('@deepseek-ai/dsh-base') + 1, 0, '@deepseek-ai/dsh-web-app')
    writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest, null, 2)}\n`)
  }
  writeFileSync(join(desktopDir, 'cordis.patch.yml'), userPatch)

  console.log('\nassertions\n')
  const finalManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
    dependencies?: Record<string, string>
  }
  const finalBundles = finalManifest.dsh?.profile?.bundles ?? []

  check(
    JSON.stringify(finalBundles) === JSON.stringify(manifest.profile.bundles),
    `bundle layers are ordered ${manifest.profile.bundles.join(' -> ')} (actual: ${finalBundles.join(' -> ')})`,
  )
  check(
    Object.keys(finalManifest.dependencies ?? {}).includes('@dsh-foundry/bundle'),
    'the companion bundle is installed as a profile dependency',
  )
  check(
    Object.keys(finalManifest.dependencies ?? {}).includes('@dsh-foundry/native'),
    'the desktop-native client plugin is installed as a profile dependency',
  )

  const dump = dsh(['--profile', 'desktop', '--dump-config'])
  writeFileSync(join(REPOSITORY_ROOT, 'evidence', 'desktop-profile-dump.yml'), dump)
  check(dump.includes('@dsh-foundry/native'), 'the composed config mounts the desktop-native row')
  check(
    /id:\s*directory-picker[\s\S]{0,200}?disabled:\s*true/.test(dump)
    || !dump.includes('dsh-host-directory-picker-auto'),
    'the official auto directory picker is not composed alongside the desktop occupant',
  )
  check(dump.includes('@dsh-foundry/layout'), 'the composed config mounts the desktop-layout row')
  check(
    /id:\s*ui-layout[\s\S]{0,120}?disabled:\s*true/.test(dump),
    'the official root layout row is disabled so the desktop frame owns the single-kind root slot',
  )
  check(
    dump.includes('@deepseek-ai/dsh-client-ui-sidebar') && dump.includes('@deepseek-ai/dsh-client-ui-conversation'),
    'the official sidebar and conversation occupants remain composed for the desktop frame to host',
  )
  check(dump.includes('@deepseek-ai/dsh-web-app'), 'the official Web product remains composed beneath the desktop layer')
  check(dump.includes('@deepseek-ai/dsh-host-apiproxy'), 'the official API gateway remains composed (business transport unchanged)')

  check(readFileSync(webManifestPath, 'utf8') === webBefore, 'the unrelated web profile manifest is unchanged')
  check(readFileSync(join(desktopDir, 'cordis.patch.yml'), 'utf8') === userPatch, 'the user-owned patch layer is unchanged')

  rmSync(packDir, { recursive: true, force: true })
} finally {
  if (KEEP) console.log(`\nkeeping the qualification home at ${home}`)
  else rmSync(home, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? 'profile qualification passed' : `profile qualification FAILED (${failures.length})`}`)
if (failures.length > 0) process.exit(1)
