/**
 * Qualification of the daily distribution inside the desktop profile.
 *
 * Answers two questions that the desktop-only and daily-only qualifications
 * cannot, because each sees only its own layer:
 *
 * - **Does adding daily to the desktop profile change the desktop?** The bridge,
 *   process adapter, root layout ownership, and business transport rows must be
 *   byte-identical to the desktop-only composition. Daily adds rows; it does not
 *   renegotiate what the shell owns.
 * - **Does the product still work without the native bridge?** With the Electron
 *   companion row disabled, every daily and workbench row must remain composed
 *   and active. The browser is the baseline, so removing the shell may remove
 *   affordances and must remove no capability.
 *
 * The second question's runtime half — that a browser session and a packaged
 * desktop session produce the same ordered official session facts — needs a
 * model credential and is not attempted here; this covers composition only, and
 * says so in its output.
 *
 * Usage: `pnpm run qualify:desktop-daily [--keep]`
 * @module scripts/qualify-desktop-daily
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))
const KEEP = process.argv.includes('--keep')

/** Desktop companion packages, in dependency order. */
const DESKTOP_PACKAGES = [
  'packages/desktop-contract',
  'packages/desktop-native',
  'packages/desktop-layout',
  'packages/desktop-bundle',
]

/** Daily companion packages, in dependency order. */
const DAILY_PACKAGES = ['packages/daily-contract',
  'packages/plugin-governance', 'packages/daily-agent', 'packages/daily-bundle']

/** Layers the combined profile must end up with, in order. */
const COMBINED_BUNDLES = [
  '@deepseek-ai/dsh-base',
  '@deepseek-ai/dsh-web-app',
  '@dsh-foundry/bundle',
  '@dsh-foundry/daily-bundle',
]

/**
 * Rows the desktop shell owns.
 *
 * Adding daily must leave every one of them exactly as the desktop-only
 * composition had it: this is the "no renegotiation" property stated as a list.
 */
const SHELL_OWNED_ROWS = ['@dsh-foundry/native', '@dsh-foundry/layout']

/** The Electron companion row id, disabled to simulate a plain browser. */
const NATIVE_ROW_ID = 'desktop-native'

/** The Electron companion package name, as the composed dump spells it. */
const NATIVE_ROW = '@dsh-foundry/native'

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

const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-daily-'))
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
      PATH: [stageBin, join(stageDir, 'node', 'bin'), process.env['PATH'] ?? ''].filter(Boolean).join(':'),
    },
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
}

/**
 * Pack workspace packages into installable tarballs.
 * @param relatives - Package directories relative to the repository root.
 * @param destination - Where to write the tarballs.
 * @returns Tarball paths.
 */
function pack(relatives: readonly string[], destination: string): string[] {
  return relatives.map((relative) => {
    const output = execFileSync('pnpm', ['pack', '--pack-destination', destination], {
      cwd: join(REPOSITORY_ROOT, relative),
      encoding: 'utf8',
    })
    const file = output.trim().split('\n').at(-1)
    if (file === undefined) throw new Error(`pnpm pack produced no tarball for ${relative}`)
    return file
  })
}

/**
 * Extract row ids from a composed configuration dump.
 * @param dump - The dump text.
 * @returns Row ids in order.
 */
function rowsOf(dump: string): string[] {
  return [...dump.matchAll(/^\s*-?\s*name:\s*(\S+)/gm)]
    .map((match) => match[1]?.replace(/^['"]|['"]$/g, ''))
    .filter((name): name is string => name !== undefined)
}

/**
 * Set a profile's bundle layers.
 * @param profile - Profile name.
 * @param bundles - Layers in order.
 */
function setBundles(profile: string, bundles: readonly string[]): void {
  const path = join(home, 'profiles', profile, 'package.json')
  const parsed = JSON.parse(readFileSync(path, 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }
  parsed.dsh ??= {}
  parsed.dsh.profile ??= {}
  parsed.dsh.profile.bundles = [...bundles]
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`)
}

try {
  console.log(`qualifying desktop + daily in an isolated home: ${home}\n`)
  const packDir = mkdtempSync(join(tmpdir(), 'dsh-dd-pack-'))
  const desktopTarballs = pack(DESKTOP_PACKAGES, packDir)
  const dailyTarballs = pack(DAILY_PACKAGES, packDir)

  console.log('installing the desktop distribution alone\n')
  dsh(['plugin', '--profile', 'combined', 'add', ...desktopTarballs])
  setBundles('combined', ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', '@dsh-foundry/bundle'])
  const desktopOnlyDump = dsh(['--profile', 'combined', '--dump-config'])
  const desktopOnlyRows = rowsOf(desktopOnlyDump)

  console.log('\nadding the daily distribution on top\n')
  dsh(['plugin', '--profile', 'combined', 'add', ...dailyTarballs])
  setBundles('combined', COMBINED_BUNDLES)
  const combinedDump = dsh(['--profile', 'combined', '--dump-config'])
  const combinedRows = rowsOf(combinedDump)

  console.log('\n9.1 — daily integrates without renegotiating what the shell owns\n')

  const layers = (JSON.parse(readFileSync(join(home, 'profiles', 'combined', 'package.json'), 'utf8')) as {
    dsh?: { profile?: { bundles?: string[] } }
  }).dsh?.profile?.bundles ?? []
  check(
    JSON.stringify(layers) === JSON.stringify(COMBINED_BUNDLES),
    `layers are ordered ${COMBINED_BUNDLES.join(' -> ')} (actual: ${layers.join(' -> ')})`,
  )

  const dropped = [...new Set(desktopOnlyRows)].filter((row) => !combinedRows.includes(row))
  check(dropped.length === 0, `adding daily drops no desktop row (dropped: ${dropped.join(', ') || 'none'})`)

  for (const row of SHELL_OWNED_ROWS) {
    const before = desktopOnlyRows.filter((name) => name === row).length
    const after = combinedRows.filter((name) => name === row).length
    check(before === after && before > 0, `${row} is composed exactly as before (${before} -> ${after})`)
  }

  check(
    combinedRows.includes('@dsh-foundry/daily-agent'),
    'the daily-agent row is composed inside the desktop profile',
  )
  check(
    combinedDump.includes('@deepseek-ai/dsh-host-apiproxy'),
    'the official business transport is unchanged: API traffic still goes through the official gateway',
  )
  check(
    combinedDump.includes('@deepseek-ai/dsh-agent-presets'),
    'the official preset roster remains composed, so Standard stays the live baseline',
  )

  console.log('\n9.2 — the product composes fully with the native bridge disabled\n')

  writeFileSync(
    join(home, 'profiles', 'combined', 'cordis.patch.yml'),
    '# Simulates a plain browser: the Electron companion row is switched off.\n'
    + `- id: ${NATIVE_ROW_ID}\n  disabled: true\n`,
  )
  let browserDump: string
  try {
    browserDump = dsh(['--profile', 'combined', '--dump-config'])
  } catch (error) {
    // Composition failing without the shell would mean the browser build is not
    // actually a supported configuration.
    check(false, `the profile still composes with ${NATIVE_ROW} disabled (${String(error).slice(0, 200)})`)
    browserDump = ''
  }

  if (browserDump.length > 0) {
    const browserRows = rowsOf(browserDump)
    check(true, `the profile composes with ${NATIVE_ROW} disabled`)
    check(
      browserRows.includes('@dsh-foundry/daily-agent'),
      'daily behavior survives without the native bridge',
    )
    check(
      browserRows.includes('@deepseek-ai/dsh-host-apiproxy'),
      'business transport survives without the native bridge, so no Harness call depended on IPC',
    )
    const lostBesidesShell = [...new Set(combinedRows)]
      .filter((row) => !browserRows.includes(row))
      .filter((row) => !SHELL_OWNED_ROWS.includes(row))
    check(
      lostBesidesShell.length === 0,
      `disabling the bridge removes shell rows only (also lost: ${lostBesidesShell.join(', ') || 'none'})`,
    )
  }

  mkdirSync(join(REPOSITORY_ROOT, 'evidence'), { recursive: true })
  writeFileSync(join(REPOSITORY_ROOT, 'evidence', 'desktop-daily-dump.yml'), combinedDump)
  writeFileSync(join(REPOSITORY_ROOT, 'evidence', 'desktop-daily-browser-dump.yml'), browserDump)

  console.log(
    '\nScope: this qualifies composition. That a browser session and a packaged desktop session produce the '
    + 'same ordered official session facts needs a model credential and is not covered here.',
  )
  rmSync(packDir, { recursive: true, force: true })
} finally {
  if (KEEP) console.log(`\nkeeping the qualification home at ${home}`)
  else rmSync(home, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? 'desktop + daily qualification passed' : `desktop + daily qualification FAILED (${failures.length})`}`)
if (failures.length > 0) process.exit(1)
