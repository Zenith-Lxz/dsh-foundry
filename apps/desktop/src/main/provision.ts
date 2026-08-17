/**
 * First-run provisioning of the desktop profile.
 *
 * A delivered application is installed and launched; there is no separate setup
 * step. The Harness home it opens will not have a `desktop` profile, and a
 * non-template profile name fails loud until something creates it — so the
 * application creates it, once, on the first launch that needs it.
 *
 * Provisioning goes through the **official** `dsh plugin --profile desktop add`
 * command rather than writing the profile directly, so the installed layout is
 * whatever the current official command produces. That command forwards to
 * `pnpm` on `PATH`, and an application launched from the desktop inherits a
 * minimal `PATH`; the staged package manager is prepended for exactly this
 * subprocess so the official path works without a developer toolchain on the
 * machine.
 *
 * The check is against real installed state, not a marker file: a profile whose
 * companion packages were removed or downgraded is re-provisioned, and a marker
 * cannot drift from what is actually on disk. The user's own
 * `cordis.patch.yml` is never read or written here.
 * @module @dsh-foundry/app/main/provision
 */
import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'
import { promisify } from 'node:util'
import type { ResolvedRuntime } from '@dsh-foundry/adapter'

const run = promisify(execFile)

/** How long the one-time install may take before it is treated as failed. */
const INSTALL_TIMEOUT_MS = 180_000

/** What provisioning needs to know about this build. */
export interface ProvisionOptions {
  /** The resolved staged runtime; its Node and CLI entry drive the official command. */
  readonly runtime: ResolvedRuntime
  /** Directory holding the companion package tarballs shipped with the application. */
  readonly companionsDir: string
  /** Profile name to create. */
  readonly profile: string
  /** Bundle layers the profile must list, in order. */
  readonly bundles: readonly string[]
  /**
   * Package scopes this distribution published under before.
   *
   * A profile left by one of those releases still names its bundle layers and
   * still has its packages installed, so nothing observable distinguishes it
   * from a layer the user added. Declaring the scopes is what makes the
   * migration auditable instead of a guess.
   */
  readonly supersededScopes: readonly string[]
  /** Companion package name whose presence marks the profile as provisioned. */
  readonly bundlePackage: string
  /**
   * Content fingerprint of the companion tarballs shipped with this build.
   *
   * Recorded in the profile after a successful install and compared on every
   * launch, because the companion version does not change between development
   * rebuilds and a version-only check leaves a stale profile in place forever.
   */
  readonly companionFingerprint: string
  /** Expected companion version; a mismatch re-provisions. */
  readonly companionVersion: string
}

/** What provisioning did, so the caller can report a first run honestly. */
export type ProvisionOutcome =
  | { readonly kind: 'already-current' }
  | { readonly kind: 'installed' }

/**
 * Resolve the Harness home the same way the official runtime does.
 * @returns Absolute path to the Harness home.
 */
export function harnessHome(): string {
  const configured = process.env['DSH_HOME']
  return configured !== undefined && configured.length > 0 ? configured : join(homedir(), '.dsh')
}

/**
 * Ensure the desktop profile exists and carries the current companion packages.
 *
 * Idempotent: a profile already at this companion version returns without
 * running any command, which is what keeps ordinary launches fast.
 * @param options - Runtime, companion tarballs, and the expected composition.
 * @returns Whether the profile was already current or had to be installed.
 * @throws Error when the official command fails, with its output attached.
 */
export async function ensureDesktopProfile(options: ProvisionOptions): Promise<ProvisionOutcome> {
  const home = harnessHome()
  const profileDir = join(home, 'profiles', options.profile)
  if (isCurrent(profileDir, options)) return { kind: 'already-current' }

  const tarballs = readdirSync(options.companionsDir)
    .filter((entry) => entry.endsWith('.tgz'))
    .map((entry) => join(options.companionsDir, entry))
  if (tarballs.length === 0) {
    throw new Error(`no companion packages are bundled with this application at ${options.companionsDir}`)
  }

  // The staged package manager and Node go first so the official command
  // resolves them instead of anything that happens to be on the inherited PATH.
  const stageBin = join(options.runtime.runtimeRoot, '..', 'bin')
  const nodeBin = dirname(options.runtime.nodePath)
  const environment = {
    ...process.env,
    DSH_HOME: home,
    PATH: [stageBin, nodeBin, process.env['PATH'] ?? ''].filter((part) => part.length > 0).join(delimiter),
  }

  // The command runs with the Harness home as its working directory, and on a
  // first launch that directory does not exist yet — a missing cwd fails the
  // spawn before the command is even reached.
  mkdirSync(home, { recursive: true })

  // Superseded entries are removed before the install, not after: they name
  // packages that only ever existed as local tarballs, so pnpm resolves them
  // against the registry, gets a 404, and fails the whole install. Every later
  // step — including dropping the stale layers — is unreachable until they are
  // gone, which is why an upgraded profile failed at launch while a fresh one
  // succeeded.
  dropSupersededEntries(profileDir, options.supersededScopes)
  // pnpm resolves a tarball by the version inside it, so re-adding a
  // same-version archive is a no-op and the profile keeps the previous build.
  // When the shipped set has changed, the installed copies are removed first so
  // the new archives are actually unpacked.
  if (readMarker(profileDir) !== options.companionFingerprint) {
    for (const scope of new Set([...options.supersededScopes, `${options.bundlePackage.split('/')[0]!}/`])) {
      rmSync(join(profileDir, 'node_modules', scope.replace(/\/$/, '')), { recursive: true, force: true })
    }
    rmSync(join(profileDir, 'pnpm-lock.yaml'), { force: true })
  }

  try {
    await run(
      options.runtime.nodePath,
      [options.runtime.dshEntry, 'plugin', '--profile', options.profile, 'add', ...tarballs],
      { cwd: home, env: environment, timeout: INSTALL_TIMEOUT_MS, maxBuffer: 32 * 1024 * 1024 },
    )
  } catch (error) {
    // The package manager reports most of its failures on stdout, so a
    // stderr-only detail would leave the surface with an empty diagnostic.
    const streams = error as { stdout?: unknown, stderr?: unknown }
    const detail = [streams.stderr, streams.stdout]
      .filter((stream) => typeof stream === 'string' && stream.length > 0)
      .join('\n')
    // The cause is retained: the message carries the command's own output,
     // but the original error holds the exit code and signal a reader needs.
    throw new Error(
      `the official plugin command failed while creating the ${options.profile} profile\n`
      + `${detail.length > 0 ? detail : String(error)}`,
      { cause: error },
    )
  }

  seatRequiredBundles(profileDir, options.bundles, options.supersededScopes)
  writeMarker(profileDir, options.companionFingerprint)

  if (!isCurrent(profileDir, options)) {
    throw new Error(
      `the ${options.profile} profile is still incomplete after installation; `
      + `expected ${options.bundlePackage}@${options.companionVersion} in ${profileDir}`,
    )
  }
  return { kind: 'installed' }
}

/**
 * Fingerprint the companion tarballs a build ships.
 *
 * Names and sizes rather than content hashes: the packager rebuilds every
 * tarball on every run, so any real change moves a size, and hashing eight
 * archives on the startup path would cost more than it establishes.
 * @param companionsDir - Directory holding the shipped tarballs.
 * @returns A stable fingerprint of the shipped set.
 */
export function fingerprintCompanions(companionsDir: string): string {
  const entries = readdirSync(companionsDir)
    .filter((entry) => entry.endsWith('.tgz'))
    .sort()
    .map((entry) => `${entry}:${statSync(join(companionsDir, entry)).size}`)
  return createHash('sha256').update(entries.join('\n')).digest('hex').slice(0, 16)
}

/** File recording which companion set a profile was provisioned from. */
const MARKER_FILE = '.dsh-foundry-companions'

/**
 * Read the companion fingerprint a profile was provisioned from.
 * @param profileDir - The profile directory.
 * @returns The recorded fingerprint, or `undefined` when none was written.
 */
function readMarker(profileDir: string): string | undefined {
  const path = join(profileDir, MARKER_FILE)
  if (!existsSync(path)) return undefined
  return readFileSync(path, 'utf8').trim()
}

/**
 * Record the companion fingerprint after a successful install.
 * @param profileDir - The profile directory.
 * @param fingerprint - Fingerprint of the installed companion set.
 */
function writeMarker(profileDir: string, fingerprint: string): void {
  writeFileSync(join(profileDir, MARKER_FILE), `${fingerprint}\n`)
}

/**
 * Remove entries left by a previous identity of this distribution.
 *
 * Both the dependency and the bundle layer go: the dependency because pnpm
 * cannot resolve a package that only ever existed as a local tarball, and the
 * layer because it would name a package this build no longer installs.
 * @param profileDir - The profile directory.
 * @param superseded - Package scopes this distribution published under before.
 */
function dropSupersededEntries(profileDir: string, superseded: readonly string[]): void {
  if (superseded.length === 0) return
  const manifestPath = join(profileDir, 'package.json')
  const manifest = readJson(manifestPath)
  if (manifest === undefined) return
  const isSuperseded = (name: string): boolean => superseded.some((scope) => name.startsWith(scope))

  const dependencies = { ...(manifest.dependencies ?? {}) }
  const removed = Object.keys(dependencies).filter(isSuperseded)
  for (const name of removed) delete dependencies[name]

  const layers = manifest.dsh?.profile?.bundles
  const keptLayers = Array.isArray(layers) ? (layers as string[]).filter((name) => !isSuperseded(name)) : undefined
  const droppedLayers = Array.isArray(layers) ? (layers as string[]).filter(isSuperseded) : []

  if (removed.length === 0 && droppedLayers.length === 0) return
  for (const name of [...removed, ...droppedLayers]) {
    console.log(`[dsh-foundry] dropping bundle layer ${name}: it belongs to a superseded release of this distribution`)
  }

  const next: Record<string, unknown> = { ...(manifest as unknown as Record<string, unknown>), dependencies }
  if (keptLayers !== undefined) {
    const dsh = { ...(manifest.dsh as Record<string, unknown> | undefined) }
    dsh['profile'] = { ...(dsh['profile'] as Record<string, unknown> | undefined), bundles: keptLayers }
    next['dsh'] = dsh
  }
  writeFileSync(manifestPath, `${JSON.stringify(next, null, 2)}\n`)
  // The installed tree still holds the old packages; the next install prunes
  // them because they are no longer declared.
  rmSync(join(profileDir, 'node_modules', '.modules.yaml'), { force: true })
}

/**
 * Report whether the profile already carries this build's companion packages.
 * @param profileDir - The profile directory.
 * @param options - Expected composition.
 * @returns True when nothing needs installing.
 */
function isCurrent(profileDir: string, options: ProvisionOptions): boolean {
  const manifest = readJson(join(profileDir, 'package.json'))
  if (manifest === undefined) return false
  const bundles = manifest.dsh?.profile?.bundles
  if (!Array.isArray(bundles)) return false
  for (const required of options.bundles) {
    if (!bundles.includes(required)) return false
  }
  // A layer this build installs but that is absent from the profile makes the
  // profile uncomposable. Official layers are excluded: they resolve from the
  // staged runtime rather than the profile, so requiring them here would make
  // the check fail on every launch and re-provision forever.
  const declared = new Set(Object.keys(manifest.dependencies ?? {}))
  for (const layer of bundles as string[]) {
    // A layer from a superseded scope means this profile came from an earlier
    // release of this product and has not been migrated.
    if (options.supersededScopes.some((scope) => layer.startsWith(scope))) return false
    if (!declared.has(layer)) continue
    if (!existsSync(join(profileDir, 'node_modules', ...layer.split('/'), 'package.json'))) return false
  }
  const installed = readJson(join(profileDir, 'node_modules', ...options.bundlePackage.split('/'), 'package.json'))
  if (installed?.['version'] !== options.companionVersion) return false
  // Version alone cannot answer this. A development build keeps the same
  // version across every rebuild, so a profile installed once would never be
  // updated again — every later verification would silently exercise the old
  // packages. The fingerprint covers the tarballs actually shipped, so any
  // rebuild that changes them re-provisions.
  return readMarker(profileDir) === options.companionFingerprint
}

/**
 * Ensure the profile lists every required bundle layer, in order.
 *
 * The official command appends the companion bundle it installed, but a fresh
 * non-template profile starts at the base layer alone — the official Web
 * product beneath the desktop layer is this application's requirement, not
 * something the command can infer.
 *
 * Only the ordered `bundles` list is touched. The user's patch file is not read.
 * @param profileDir - The profile directory.
 * @param required - Bundle layers in the order they must apply.
 * @param superseded - Package scopes this distribution published under before.
 */
function seatRequiredBundles(
  profileDir: string,
  required: readonly string[],
  superseded: readonly string[],
): void {
  const manifestPath = join(profileDir, 'package.json')
  const manifest = readJson(manifestPath)
  if (manifest === undefined) throw new Error(`the profile manifest is missing at ${manifestPath}`)
  const current: unknown = manifest['dsh']?.['profile']?.['bundles']
  const existing = Array.isArray(current) ? (current as string[]) : []
  // A layer is dropped when it is either broken or ours-but-superseded:
  //
  // - its package is not installed, so the composition cannot resolve it, or
  // - it sits in a scope this distribution used to publish under, which a
  //   rename leaves behind complete with its installed packages. Neither the
  //   layer list nor node_modules can distinguish that from a layer the user
  //   added, so the superseded scopes are declared in compatibility.json.
  //
  // Official layers resolve from the staged runtime, so their absence from the
  // profile's node_modules is normal and never drops them.
  const extra = existing.filter((name) => {
    if (required.includes(name)) return false
    if (superseded.some((scope) => name.startsWith(scope))) return false
    return name.startsWith('@deepseek-ai/')
      || existsSync(join(profileDir, 'node_modules', ...name.split('/'), 'package.json'))
  })
  const dropped = existing.filter((name) => !required.includes(name) && !extra.includes(name))
  for (const name of dropped) {
    console.log(`[dsh-foundry] dropping bundle layer ${name}: its package is not installed in this profile`)
  }
  const next = [...required, ...extra]
  if (next.length === existing.length && next.every((name, index) => existing[index] === name)) return
  const dsh = { ...(manifest['dsh'] as Record<string, unknown> | undefined) }
  dsh['profile'] = { ...(dsh['profile'] as Record<string, unknown> | undefined), bundles: next }
  writeFileSync(manifestPath, `${JSON.stringify({ ...manifest, dsh }, null, 2)}\n`)
}

/** The profile manifest fields provisioning reads. */
interface ProfileManifest {
  readonly version?: unknown
  readonly dependencies?: Record<string, string>
  readonly dsh?: { readonly profile?: { readonly bundles?: unknown } }
}

/**
 * Read a JSON file, treating any read or parse failure as absent.
 * @param path - Absolute file path.
 * @returns The parsed object, or `undefined`.
 */
function readJson(path: string): ProfileManifest | undefined {
  if (!existsSync(path)) return undefined
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as ProfileManifest
  } catch {
    // A malformed manifest is treated as "not provisioned", which makes the
    // next step rewrite it rather than fail on a file the user never edited.
    return undefined
  }
}
