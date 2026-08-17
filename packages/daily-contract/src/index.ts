/**
 * Closed data types and runtime validation shared across the daily distribution.
 *
 * This package holds no behavior and imports nothing from the official runtime:
 * it is the vocabulary the Bundle, agent decorator, workbench, governance, and
 * evaluation packages agree on, so a change to one of them cannot silently
 * redefine a shared meaning.
 *
 * Types that cross a **durable or wire boundary** carry an explicit version and
 * a documented unknown-field rule. Types that stay inside one process rely on
 * the static interface instead, because validating a value the compiler already
 * guarantees adds a failure path with no reachable cause.
 * @module @dsh-foundry/daily-contract
 */

/** Version of the durable and wire types in this module. */
export const DAILY_CONTRACT_VERSION = 1 as const

/**
 * The presentation mode a session runs under.
 *
 * `daily` decorates the official Standard preset. `adaptive` is the opt-in
 * experiment that begins with official Minimal identity and promotes once.
 * A session using an official preset without daily decoration has no mode.
 */
export const DISTRIBUTION_MODES = ['daily', 'adaptive'] as const

/** One distribution mode. */
export type DistributionMode = (typeof DISTRIBUTION_MODES)[number]

/**
 * Official preset directory ids, which are what the runtime resolves.
 *
 * The display names differ from the ids for two of them — `code` presents as
 * PTC and `cordis` as Creator — so code that matches on a display name will
 * silently miss. Match on these ids.
 */
export const OFFICIAL_PRESETS = {
  standard: 'standard',
  minimal: 'minimal',
  /** Presents as "PTC 模式"; the directory id is `code`. */
  ptc: 'code',
  /** Presents as "创造模式"; the directory id is `cordis`. */
  creator: 'cordis',
} as const

/** One official preset directory id. */
export type OfficialPresetId = (typeof OFFICIAL_PRESETS)[keyof typeof OFFICIAL_PRESETS]

/** The preset daily mode decorates. Daily never mounts on any other preset. */
export const DAILY_BASE_PRESET: OfficialPresetId = OFFICIAL_PRESETS.standard

/**
 * Adaptive phase, derived from official durable records rather than stored.
 *
 * `minimal-first` means the session has no durable `assistant/message` and no
 * `tool/call` yet; `promoted` means at least one exists. Deriving rather than
 * storing is what lets a resumed session reconstruct the correct phase without
 * a private event type or a sidecar trajectory format.
 */
export const ADAPTIVE_PHASES = ['minimal-first', 'promoted'] as const

/** One adaptive phase. */
export type AdaptivePhase = (typeof ADAPTIVE_PHASES)[number]

/** Why a distribution capability refused to activate. */
export const COMPATIBILITY_FAILURES = [
  'dsh-version-unsupported',
  'missing-public-export',
  'missing-plugin-row',
  'missing-client-slot',
  'minimal-identity-unprovable',
  'duplicate-owner',
] as const

/** One compatibility failure class. */
export type CompatibilityFailure = (typeof COMPATIBILITY_FAILURES)[number]

/**
 * One resolved compatibility finding.
 *
 * A finding names the contract and the mode it gates, so a refusal can say what
 * stopped working rather than only that something did.
 */
export interface CompatibilityFinding {
  readonly failure: CompatibilityFailure
  /** The public identifier that was required. */
  readonly contract: string
  /** What the distribution will not do because of it. */
  readonly consequence: string
}

/** Capability tiers. Only `core` installs and activates with the base distribution. */
export const CAPABILITY_TIERS = ['core', 'optional-qualified', 'community-unreviewed'] as const

/** One capability tier. */
export type CapabilityTier = (typeof CAPABILITY_TIERS)[number]

/**
 * Authority a package holds once installed.
 *
 * Every field describes something the model's tool-approval flow does **not**
 * mediate: plugin code runs in the Host process with the user's own authority.
 * Governance renders these before an install and never describes them as
 * sandboxed.
 */
export interface PackageAuthority {
  /** Runs code inside the DSH Host process. */
  readonly hostProcess: boolean
  /** Runs install or build lifecycle scripts. */
  readonly lifecycleScripts: boolean
  /** Builds or loads native artifacts. */
  readonly nativeDependencies: boolean
  /** Contributes prompt text, tool schemas, or UI the model or user sees. */
  readonly modelVisibleContributions: boolean
  /** Reads or writes files outside the package. */
  readonly fileAccess: boolean
  /** Makes network requests. */
  readonly networkAccess: boolean
  /** Persists data that survives removal. */
  readonly dataPersistence: boolean
  /** Launches an MCP server executable, which is trusted external code. */
  readonly mcpExecutable: boolean
}

/** Health of one installed package in a target profile. */
export interface PackageHealth {
  readonly packageName: string
  /** Resolved version, or `undefined` when resolution failed. */
  readonly version: string | undefined
  /** Where the package manager resolved it from. */
  readonly source: string | undefined
  readonly tier: CapabilityTier
  readonly activated: boolean
  /** Findings that keep this package from being healthy; empty means healthy. */
  readonly findings: readonly CompatibilityFinding[]
}

/**
 * Evidence that a verification command actually ran.
 *
 * `exitCode` is the whole point: an agent's prose about a passing check is not
 * evidence, and a command that was never executed has no exit code to report.
 */
export interface VerificationEvidence {
  /** The command as recorded by the official tool call. */
  readonly command: string
  /** Process exit code; `undefined` when the command did not complete. */
  readonly exitCode: number | undefined
  /** Durable session event sequence this evidence was derived from. */
  readonly sequence: number
  /** Whether the recorded outcome supports a claim of success. */
  readonly passed: boolean
}

/**
 * Report whether a value is a plain object usable as a validated record.
 * @param value - Candidate.
 * @returns True for a non-null, non-array object.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Narrow a value to a distribution mode.
 * @param value - Candidate, typically from settings or a durable record.
 * @returns The mode, or `undefined` when the value is not one.
 */
export function asDistributionMode(value: unknown): DistributionMode | undefined {
  return DISTRIBUTION_MODES.find((mode) => mode === value)
}

/**
 * Narrow a value to a capability tier.
 * @param value - Candidate, typically from a package manifest.
 * @returns The tier, or `undefined` when the value is not one.
 */
export function asCapabilityTier(value: unknown): CapabilityTier | undefined {
  return CAPABILITY_TIERS.find((tier) => tier === value)
}

/**
 * Validate a durable mode selection record.
 *
 * Unknown fields are **ignored rather than rejected**: this value crosses a
 * durable boundary, and a record written by a newer distribution must remain
 * readable by an older one rather than making the session unloadable.
 * @param value - Raw record.
 * @returns The validated selection, or `undefined` when the mode is unusable.
 */
export function parseModeSelection(value: unknown): { mode: DistributionMode, contractVersion: number } | undefined {
  if (!isRecord(value)) return undefined
  const mode = asDistributionMode(value['mode'])
  if (mode === undefined) return undefined
  const raw = value['contractVersion']
  return { mode, contractVersion: typeof raw === 'number' ? raw : DAILY_CONTRACT_VERSION }
}

/**
 * Shown against any plugin this distribution did not review.
 *
 * Lives here rather than in the governance package because both the Node half
 * and the browser half render it, and the governance package reads the
 * filesystem — importing it from a client bundle pulls `node:fs` into the page.
 */
export const USER_AUTHORITY_WARNING =
  'This plugin runs with your user authority. The approval prompts you see for model tool calls do not apply to '
  + 'plugin code or to MCP servers, and this distribution has not reviewed it.'

/** Where a plugin came from. */
export const PROVENANCE_SOURCES = ['official', 'foundry', 'user', 'workspace', 'unknown'] as const

/** One provenance answer. */
export type ProvenanceSource = (typeof PROVENANCE_SOURCES)[number]

/** What the distribution knows about one installed package. */
export interface PluginProvenance {
  readonly packageName: string
  readonly displayName: string
  readonly version: string
  readonly source: ProvenanceSource
  /** What established the source; absent when the source is `unknown`. */
  readonly evidence: { readonly field: string, readonly value: string } | null
  readonly profile: string
  readonly bundle: string | null
  readonly enabled: boolean
  /** True only for packages this distribution built and qualified. */
  readonly foundryVerified: boolean
  readonly disableable: boolean
  readonly disableImpact: string
}
