/**
 * Authority disclosure.
 *
 * A DSH plugin is npm code that runs **inside the Host process with the user's
 * own authority**. The model's tool-approval flow does not mediate it: approvals
 * gate what the *model* asks to do, not what plugin code does when it loads. An
 * MCP server is further out still — a separate executable the Host launches.
 *
 * Almost no distribution says this before an install, and the gap matters:
 * a user who has seen "approve this command?" dialogs reasonably assumes the
 * same protection covers a plugin. It does not.
 *
 * This module derives what a package can do from what it declares, so the
 * disclosure is a property of the artifact rather than a promise in a README.
 * It is deliberately **conservative**: an unreadable or ambiguous manifest
 * reports more authority, never less, because an understated disclosure is the
 * only failure mode that gets someone hurt.
 * @module @dsh-foundry/plugin-governance/authority
 */
import type { CapabilityTier, PackageAuthority } from '@dsh-foundry/daily-contract'

/** The manifest fields authority is derived from. */
export interface PackageManifest {
  readonly name?: string
  readonly version?: string
  readonly scripts?: Readonly<Record<string, string>>
  readonly dependencies?: Readonly<Record<string, string>>
  readonly optionalDependencies?: Readonly<Record<string, string>>
  readonly dsh?: {
    readonly bundle?: { readonly patch?: string }
    readonly client?: unknown
  }
  /** Native build declaration used by node-gyp-style packages. */
  readonly gypfile?: boolean
  readonly binary?: unknown
}

/** Lifecycle script names that execute on install. */
const LIFECYCLE_SCRIPTS = ['preinstall', 'install', 'postinstall', 'prepare', 'prepublish']

/** Dependency names that indicate a native build or prebuilt binary. */
const NATIVE_MARKERS = ['node-gyp', 'prebuild-install', 'node-addon-api', 'bindings', 'nan', 'cmake-js', 'koffi']

/** Dependency names that indicate an MCP server executable. */
const MCP_MARKERS = ['@modelcontextprotocol/sdk', 'mcp-server', '@modelcontextprotocol/server']

/** What the caller knows about how the package is composed. */
export interface AuthorityContext {
  /**
   * Whether the package can be mounted as a Cordis row in the Host process.
   *
   * **Defaults to `true`.** A package installed into a profile is a candidate
   * row regardless of whether it declares a Bundle: a Bundle patch can name any
   * installed package, which is exactly how this distribution's own agent
   * plugin runs in the Host while declaring no Bundle of its own. Keying host
   * authority on the Bundle declaration alone under-reports precisely the
   * packages that execute there.
   *
   * A caller that knows a package is a transitive library rather than a profile
   * plugin passes `false`.
   */
  readonly mountedAsHostRow?: boolean
}

/**
 * Derive what a package can do once installed.
 *
 * Every `true` here means "this package can do this", not "it does". The
 * distinction matters for a disclosure: the user is being told what they are
 * granting, and a capability that is present but unused is still granted.
 * @param manifest - The package's own manifest.
 * @param context - What the caller knows about how it is composed.
 * @returns The authority the package holds once installed.
 */
export function deriveAuthority(manifest: PackageManifest, context: AuthorityContext = {}): PackageAuthority {
  const scripts = manifest.scripts ?? {}
  const dependencies = { ...manifest.dependencies, ...manifest.optionalDependencies }
  const dependencyNames = Object.keys(dependencies)

  const lifecycleScripts = LIFECYCLE_SCRIPTS.some((name) => typeof scripts[name] === 'string')
  const nativeDependencies = manifest.gypfile === true
    || manifest.binary !== undefined
    || dependencyNames.some((name) => NATIVE_MARKERS.some((marker) => name.includes(marker)))
  const mcpExecutable = dependencyNames.some((name) => MCP_MARKERS.some((marker) => name.includes(marker)))

  // Host authority is the default, not a deduction. A Bundle mounts rows; a
  // plain package can be named as a row by someone else's Bundle; an install
  // script runs before anything is mounted at all. Only a caller that knows the
  // package is a transitive library can rule it out.
  const hostProcess = (context.mountedAsHostRow ?? true) || lifecycleScripts || mcpExecutable

  return {
    hostProcess,
    lifecycleScripts,
    nativeDependencies,
    // A Bundle contributes rows that can add prompts, tools, or UI; a client
    // package contributes UI. Either way the model or the user sees it.
    modelVisibleContributions: manifest.dsh?.bundle?.patch !== undefined || manifest.dsh?.client !== undefined,
    // Host-process code can reach the filesystem and network; there is no
    // manifest field that narrows this, so it is disclosed as present rather
    // than guessed away.
    fileAccess: hostProcess,
    networkAccess: hostProcess,
    dataPersistence: hostProcess,
    mcpExecutable,
  }
}

/**
 * Authority a package is assumed to hold when its manifest cannot be read.
 *
 * Maximal on purpose. An unreadable manifest is not evidence of safety, and the
 * only disclosure that cannot mislead is the one that overstates.
 */
export const UNKNOWN_AUTHORITY: PackageAuthority = {
  hostProcess: true,
  lifecycleScripts: true,
  nativeDependencies: true,
  modelVisibleContributions: true,
  fileAccess: true,
  networkAccess: true,
  dataPersistence: true,
  mcpExecutable: true,
}

/** One line of a disclosure, ready to render. */
export interface DisclosureLine {
  readonly capability: string
  readonly granted: boolean
  /** What the user is actually agreeing to. */
  readonly meaning: string
}

/**
 * Render an authority set as reviewable statements.
 *
 * Phrased as consequences rather than field names: "runs code in the Harness
 * host process with your user account's permissions" is a decision someone can
 * make, and `hostProcess: true` is not.
 * @param authority - The derived authority.
 * @returns One line per capability, granted first.
 */
export function describeAuthority(authority: PackageAuthority): readonly DisclosureLine[] {
  const lines: DisclosureLine[] = [
    {
      capability: 'Host process',
      granted: authority.hostProcess,
      meaning: 'Runs code inside the Harness host process with your user account\'s permissions. '
        + 'Model tool approvals do not sandbox this code.',
    },
    {
      capability: 'Install scripts',
      granted: authority.lifecycleScripts,
      meaning: 'Executes commands on your machine during installation, before you use it.',
    },
    {
      capability: 'Native components',
      granted: authority.nativeDependencies,
      meaning: 'Builds or loads compiled binaries, which are not readable as source.',
    },
    {
      capability: 'Model-visible contributions',
      granted: authority.modelVisibleContributions,
      meaning: 'Adds prompt text, tool schemas, or interface elements that shape what the model does.',
    },
    {
      capability: 'File access',
      granted: authority.fileAccess,
      meaning: 'Can read and write files your user account can reach, not only the workspace.',
    },
    {
      capability: 'Network access',
      granted: authority.networkAccess,
      meaning: 'Can make network requests, including sending data it has read.',
    },
    {
      capability: 'Data persistence',
      granted: authority.dataPersistence,
      meaning: 'Can store data that survives removing the plugin.',
    },
    {
      capability: 'MCP executable',
      granted: authority.mcpExecutable,
      meaning: 'Launches a separate external program that runs entirely outside the agent sandbox.',
    },
  ]
  return [...lines].sort((a, b) => Number(b.granted) - Number(a.granted))
}

/**
 * The sentence every non-core disclosure must carry.
 *
 * Kept as a constant so no surface can render a disclosure without it, and so a
 * test can assert its presence rather than trusting each call site.
 */
export const AUTHORITY_WARNING =
  'Plugins run with your user authority. The approval prompts you see for model tool calls do not apply to plugin code or to MCP servers.'

/**
 * Report whether a tier may install without an explicit user decision.
 * @param tier - The capability tier.
 * @returns True only for the locked core set.
 */
export function installsAutomatically(tier: CapabilityTier): boolean {
  return tier === 'core'
}
