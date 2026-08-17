/**
 * Closed runtime resolution: every executable and module the supervised child
 * needs comes from this target's own production stage.
 *
 * There is no global-executable fallback, no source-checkout fallback, and no
 * cross-target fallback. A stage that is absent, built for another target, or
 * carrying an unsupported DSH version fails before any child process starts,
 * because a runtime whose identity is ambiguous cannot be qualified.
 * @module @dsh-foundry/adapter/resolve
 */
import { readFileSync, existsSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { satisfies, valid } from 'semver'

/** Directory names inside one production stage. */
const STAGE_NODE_DIR = 'node'
const STAGE_RUNTIME_DIR = 'runtime'

/** Compatibility facts the adapter reads from the repository manifest. */
export interface CompatibilityManifest {
  /** This companion release's own version, used to detect a stale installed profile. */
  readonly companionVersion: string
  readonly dsh: { readonly range: string, readonly tested: string, readonly package: string, readonly bin: string }
  readonly readinessAdapter: { readonly version: number }
  readonly bridge: { readonly version: number }
  readonly electron: { readonly version: string }
  readonly profile: {
    readonly name: string
    /** Package name of the companion bundle whose installed version marks the profile current. */
    readonly bundle: string
    readonly bundles: readonly string[]
    /** Package scopes this distribution published under before, if any. */
    readonly supersededScopes?: readonly string[]
  }
  readonly targets: Readonly<Record<string, TargetManifest>>
  readonly requiredPackages: readonly string[]
  readonly requiredSlots: readonly string[]
}

/** One qualification target's staged runtime facts. */
export interface TargetManifest {
  readonly platform: string
  readonly arch: string
  readonly node: {
    readonly version: string
    readonly artifact: string
    readonly sha256: string
    readonly binary: string
  }
  readonly acceptance: string
}

/** A resolved, version-checked runtime rooted in one production stage. */
export interface ResolvedRuntime {
  /** `<platform>-<arch>`, matching the running process. */
  readonly target: string
  /** Absolute path to the staged Node executable. */
  readonly nodePath: string
  /** Absolute path to the official CLI entry inside the staged closure. */
  readonly dshEntry: string
  /** Absolute path of the staged runtime root, used as the child's working directory anchor. */
  readonly runtimeRoot: string
  /** Exact official DSH version present in the stage. */
  readonly dshVersion: string
  /** Accepted range this version satisfied. */
  readonly range: string
}

/** Why runtime resolution refused to start a child. */
export class RuntimeResolutionError extends Error {
  readonly code:
    | 'unsupported-target'
    | 'stage-missing'
    | 'node-missing'
    | 'runtime-missing'
    | 'version-unreadable'
    | 'version-unsupported'

  /**
   * @param code - Failure classification.
   * @param message - Operator-facing description including expected and detected values.
   */
  constructor(code: RuntimeResolutionError['code'], message: string) {
    super(message)
    this.name = 'RuntimeResolutionError'
    this.code = code
  }
}

/**
 * Read and parse the companion compatibility manifest.
 * @param path - Absolute path to `compatibility.json`.
 * @returns The parsed manifest.
 */
export function readCompatibilityManifest(path: string): CompatibilityManifest {
  return JSON.parse(readFileSync(path, 'utf8')) as CompatibilityManifest
}

/**
 * The target key for a platform and architecture pair.
 * @param platform - Node platform string.
 * @param arch - Node architecture string.
 * @returns `<platform>-<arch>`.
 */
export function targetKey(platform: string = process.platform, arch: string = process.arch): string {
  return `${platform}-${arch}`
}

/**
 * Resolve the runtime for the current target from its production stage.
 *
 * Every failure names both the expected and the detected value so an operator
 * can act on it without reading logs from inside the packaged application.
 * @param options - Stage root, manifest, and the target being resolved.
 * @returns The resolved, version-checked runtime.
 * @throws RuntimeResolutionError when the target is unsupported, the stage is
 * absent or incomplete, or the staged DSH version is outside the accepted range.
 */
export function resolveRuntime(options: {
  readonly stageRoot: string
  readonly manifest: CompatibilityManifest
  readonly target?: string
}): ResolvedRuntime {
  const target = options.target ?? targetKey()
  const targetManifest = options.manifest.targets[target]
  if (targetManifest === undefined) {
    const supported = Object.keys(options.manifest.targets).join(', ')
    throw new RuntimeResolutionError(
      'unsupported-target',
      `this build supports ${supported}; the running process reports ${target}`,
    )
  }

  const stageDir = join(options.stageRoot, target)
  if (!isDirectory(stageDir)) {
    throw new RuntimeResolutionError(
      'stage-missing',
      `no production stage for ${target} at ${stageDir}; run the staging step for this target`,
    )
  }

  const nodePath = join(stageDir, STAGE_NODE_DIR, targetManifest.node.binary)
  if (!existsSync(nodePath)) {
    throw new RuntimeResolutionError(
      'node-missing',
      `staged Node ${targetManifest.node.version} for ${target} is missing at ${nodePath}`,
    )
  }

  const runtimeRoot = join(stageDir, STAGE_RUNTIME_DIR)
  const packageRoot = join(runtimeRoot, 'node_modules', ...options.manifest.dsh.package.split('/'))
  const dshEntry = join(packageRoot, options.manifest.dsh.bin)
  if (!existsSync(dshEntry)) {
    throw new RuntimeResolutionError(
      'runtime-missing',
      `staged ${options.manifest.dsh.package} entry is missing at ${dshEntry}`,
    )
  }

  const dshVersion = readStagedVersion(join(packageRoot, 'package.json'))
  if (!satisfies(dshVersion, options.manifest.dsh.range, { includePrerelease: true })) {
    throw new RuntimeResolutionError(
      'version-unsupported',
      `staged ${options.manifest.dsh.package} is ${dshVersion}, outside the supported range `
      + `${options.manifest.dsh.range} (tested: ${options.manifest.dsh.tested}); runtime at ${packageRoot}`,
    )
  }

  return { target, nodePath, dshEntry, runtimeRoot, dshVersion, range: options.manifest.dsh.range }
}

/**
 * Read the exact version from a staged package manifest.
 * @param manifestPath - Absolute path to the staged `package.json`.
 * @returns The valid semver string it declares.
 * @throws RuntimeResolutionError when the file is unreadable or its version is not valid semver.
 */
function readStagedVersion(manifestPath: string): string {
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(manifestPath, 'utf8'))
  } catch {
    // An unreadable staged manifest makes runtime identity unknowable, which is
    // exactly the ambiguity a closed stage exists to prevent.
    throw new RuntimeResolutionError('version-unreadable', `cannot read staged runtime manifest at ${manifestPath}`)
  }
  const version = (raw as { version?: unknown }).version
  if (typeof version !== 'string' || valid(version) === null) {
    throw new RuntimeResolutionError(
      'version-unreadable',
      `staged runtime manifest at ${manifestPath} declares no valid version`,
    )
  }
  return version
}

/**
 * Report whether a path is an existing directory.
 * @param path - Candidate path.
 * @returns True when the path exists and is a directory.
 */
function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    // Absent path; the caller's message distinguishes missing from malformed.
    return false
  }
}
