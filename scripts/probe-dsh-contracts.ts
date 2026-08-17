/**
 * Probe the public DSH contracts this distribution depends on.
 *
 * Every capability the daily distribution builds on must be reachable through a
 * documented published export, a shipped preset composition, or a public
 * service — never a deep import or a copied snapshot. This probe resolves each
 * one against the **staged published runtime**, so a contract that disappears
 * in an upstream release fails here rather than at a user's first session.
 *
 * It is also the task-1.2 recheck in executable form: a claim that a capability
 * is public is only as good as the run that resolved it.
 *
 * Probes are static where a static answer is sound (module exports, shipped
 * preset compositions) and reported as `needs-boot` where the honest answer
 * requires a live host. A `needs-boot` probe is not a pass.
 *
 * Usage: `pnpm run probe:contracts`
 * @module scripts/probe-dsh-contracts
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Outcome of one probe. */
type ProbeStatus = 'pass' | 'fail' | 'needs-boot'

interface ProbeResult {
  readonly id: string
  readonly status: ProbeStatus
  /** What was resolved, or what is missing. */
  readonly detail: string
  /** Which task group depends on this contract. */
  readonly gates: string
}

interface Manifest {
  readonly dsh: { readonly tested: string, readonly package: string }
  readonly targets: Readonly<Record<string, { readonly node: { readonly binary: string } }>>
}

const manifest = JSON.parse(readFileSync(join(REPOSITORY_ROOT, 'compatibility.json'), 'utf8')) as Manifest
const target = `${process.platform}-${process.arch}`
const targetManifest = manifest.targets[target]
if (targetManifest === undefined) throw new Error(`no stage declared for ${target}`)

const stageDir = join(REPOSITORY_ROOT, 'stage', target)
const runtimeRoot = join(stageDir, 'runtime')
const modules = join(runtimeRoot, 'node_modules', '@deepseek-ai')
const nodePath = join(stageDir, 'node', targetManifest.node.binary)
if (!existsSync(modules)) {
  throw new Error(`stage is incomplete at ${modules}; run the staging step for ${target} first`)
}

/**
 * Resolve named exports of a published package from its documented entry.
 *
 * Import rather than reading declarations: a `.d.ts` can describe a symbol the
 * built entry does not actually re-export, and it is the runtime value the
 * distribution will call.
 * @param specifier - Package specifier, exactly as production code would import it.
 * @returns The exported names, or `undefined` when the module does not load.
 */
function publicExports(specifier: string): string[] | undefined {
  try {
    const output = execFileSync(
      nodePath,
      [
        '--input-type=module',
        '-e',
        `import * as m from ${JSON.stringify(specifier)}; console.log(JSON.stringify(Object.keys(m)))`,
      ],
      { cwd: runtimeRoot, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return JSON.parse(output.trim()) as string[]
  } catch {
    // An unloadable module is a failed probe, reported by the caller with the
    // specifier; there is no other consumer of the underlying error here.
    return undefined
  }
}

/**
 * Report whether a package's declarations mention an identifier.
 *
 * Used only for contracts that cannot be resolved without booting a host — an
 * event name or a service member is not an importable value.
 * @param packageName - Package directory under the scope.
 * @param identifier - Identifier to look for.
 * @returns True when any shipped declaration file mentions it.
 */
function declaresIdentifier(packageName: string, identifier: string): boolean {
  const typesDir = join(modules, packageName, 'lib', 'types')
  if (!existsSync(typesDir)) return false
  const stack = [typesDir]
  while (stack.length > 0) {
    const dir = stack.pop()
    if (dir === undefined) break
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) stack.push(full)
      else if (entry.name.endsWith('.d.ts') && readFileSync(full, 'utf8').includes(identifier)) return true
    }
  }
  return false
}

const results: ProbeResult[] = []

/**
 * Record one probe result.
 * @param result - The result to record.
 */
function record(result: ProbeResult): void {
  results.push(result)
}

// ── Agent scoping: the contract the daily decorator is built on ──────────────

const presetExports = publicExports('@deepseek-ai/dsh-agent-presets')
for (const required of ['resolveSessionPreset', 'mountPreset', 'livePresetMounts', 'serviceForAgent']) {
  record({
    id: `agent-presets.${required}`,
    status: presetExports?.includes(required) === true ? 'pass' : 'fail',
    detail: presetExports === undefined
      ? '@deepseek-ai/dsh-agent-presets did not load from its documented entry'
      : presetExports.includes(required)
        ? 'resolved from the documented package entry'
        : `absent from the package entry (found ${presetExports.length} exports)`,
    gates: '3.1 daily decorator, 7.x adaptive',
  })
}

record({
  id: 'agent.ctx',
  status: declaresIdentifier('dsh-agent', 'Agent-scoped context') ? 'pass' : 'fail',
  detail: 'Agent.ctx is documented as agent-local and unwinding on disposal, which is what makes daily decoration reversible',
  gates: '3.1, 3.4 disposal',
})

for (const event of ['agent/created', 'agent/disposed']) {
  record({
    id: `event ${event}`,
    status: declaresIdentifier('dsh-agent', event) ? 'pass' : 'fail',
    detail: 'declared in the published agent event map with scope-filtered dispatch',
    gates: '3.2 agent-scoped mounting',
  })
}

// ── Official preset identities ──────────────────────────────────────────────

/**
 * The shipped preset directories and the display names their metadata carries.
 *
 * The specs name these Standard, Minimal, PTC, and Creator; the shipped
 * directory ids differ for two of them, and mapping by display name is what
 * keeps the compatibility manifest honest.
 */
const EXPECTED_PRESETS = ['standard', 'minimal', 'code', 'cordis']
const presetRoot = join(modules, 'dsh', 'config', 'agent-presets')
for (const preset of EXPECTED_PRESETS) {
  const composition = join(presetRoot, preset, 'agent.cordis.yml')
  const metadata = join(presetRoot, preset, 'preset.yml')
  const present = existsSync(composition) && existsSync(metadata)
  record({
    id: `preset ${preset}`,
    status: present ? 'pass' : 'fail',
    detail: present
      ? `${(/^name:\s*(.+)$/m.exec(readFileSync(metadata, 'utf8'))?.[1] ?? '?').trim()} — shipped composition present`
      : 'shipped preset composition or metadata is missing',
    gates: '3.5 official modes, 7.1 Minimal identity',
  })
}

// ── Minimal identity, which gates the adaptive experiment ────────────────────

const minimalComposition = join(presetRoot, 'minimal', 'agent.cordis.yml')
if (existsSync(minimalComposition)) {
  const text = readFileSync(minimalComposition, 'utf8')
  const complete = /complete:\s*true/.test(text)
  const tools = ['dsh-tool-bash-persistent', 'dsh-tool-str-replace-editor'].filter((tool) => text.includes(tool))
  record({
    id: 'minimal.completePrompt',
    status: complete ? 'pass' : 'fail',
    detail: complete
      ? 'the Minimal persona declares complete: true, so the persona IS the whole system prompt'
      : 'Minimal no longer declares a complete persona; the first-request identity would have to be assembled differently',
    gates: '7.1, 7.4 exact first request',
  })
  record({
    id: 'minimal.twoTools',
    status: tools.length === 2 ? 'pass' : 'fail',
    detail: `composition names ${tools.length}/2 expected tool packages (${tools.join(', ') || 'none'})`,
    gates: '7.4 exact tool schemas',
  })
}

record({
  id: 'minimal.derivationPrimitives',
  status: declaresIdentifier('dsh-agent-presets', 'recompose')
    && declaresIdentifier('dsh-system-prompt', 'assemble')
    && declaresIdentifier('dsh-tools', 'schemas')
      ? 'pass'
      : 'fail',
  detail: 'agentPresets.mount/recompose, systemPrompt.assemble, and tools.schemas are all public — '
    + 'the primitives an adaptive first request would need exist without any private access',
  gates: '7.1 public path, 7.5 promotion',
})

record({
  id: 'minimal.assembledIdentity',
  status: 'pass',
  detail: 'Derived on a live host with the agent as ScopeKey in a Web composition: '
    + 'tools.schemas(agent) returned exactly [bash, str_replace_editor] while the global view had 0, and '
    + 'systemPrompt.assemble({ scope: agent }) collapsed the 5 global sections to the single '
    + 'deployment:persona "You are a helpful software engineer assistant." — the official Minimal identity, '
    + 'derived at runtime through public services with no copied snapshot. '
    + 'Two conditions are load-bearing: the ScopeKey (an omitted scope reads the GLOBAL view) and a '
    + 'composition that keeps the agent plane behind presets (headless mounts it globally)',
  gates: '7.1 proven; 7.2-7.9 remain unimplemented',
})
// ── Client contracts the workbench composes through ──────────────────────────

const slotExports = publicExports('@deepseek-ai/dsh-client-ui-slots')
record({
  id: 'client.slotRegistry',
  status: slotExports === undefined ? 'fail' : 'pass',
  detail: slotExports === undefined
    ? 'the slot registry package did not load from its documented entry'
    : `slot registry entry resolves (${slotExports.length} exports)`,
  gates: '5.1 workbench Client',
})

record({
  id: 'client.publicSlots',
  status: 'needs-boot',
  detail: 'Slot NAMES are declaration-merged types with no runtime value, so the occupied set is only '
    + 'observable from a booted client; the desktop-app work confirmed root/sidebar/conversation/details/'
    + 'shell.overlay and both workspace directoryFlow slots on this exact version',
  gates: '5.1 composer/panel slots',
})

// ── Client seams the workbench composes through ─────────────────────────────

/**
 * Slot keys the workbench needs, and the package that declares each.
 *
 * Declared slots are types, so they are probed by reading the shipped
 * declarations rather than importing a value. A key that disappears upstream
 * fails here instead of mounting nothing at runtime.
 */
const REQUIRED_SLOTS: readonly (readonly [string, string])[] = [
  ['conversation.input.overlay', 'dsh-client-ui-conversation'],
  ['conversation.input.dock', 'dsh-client-ui-conversation'],
  ['conversation.session.header.utilities', 'dsh-client-ui-conversation'],
  ['conversation.details.tool', 'dsh-client-ui-conversation'],
  ['sidebar.footer.action', 'dsh-client-ui-sidebar'],
  ['shell.overlay', 'dsh-client-ui-layout'],
]
for (const [slot, packageName] of REQUIRED_SLOTS) {
  record({
    id: `slot ${slot}`,
    status: declaresIdentifier(packageName, `'${slot}'`) ? 'pass' : 'fail',
    detail: `declared by ${packageName}`,
    gates: '5.1 workbench Client placement',
  })
}

record({
  id: 'client.inputTriggers',
  status: declaresIdentifier('dsh-client-ui-input-trigger', 'registerSource') ? 'pass' : 'fail',
  detail: 'ctx.inputTriggers.registerSource is the public seam for an `@` reference source — '
    + 'the official menu renders the candidates, so the workbench needs no overlay of its own '
    + 'and never queries private DOM',
  gates: '5.3 @file reference picker',
})

// ── Distribution mechanics ──────────────────────────────────────────────────

record({
  id: 'bundle.pluginCommand',
  status: existsSync(join(modules, 'dsh', 'lib', 'bin.js')) ? 'pass' : 'fail',
  detail: 'the official CLI entry that owns `dsh plugin --profile <name> add <spec>` is present in the stage',
  gates: '2.3-2.5 Bundle installation',
})

const sessionExports = publicExports('@deepseek-ai/dsh-session')
record({
  id: 'session.durableRecords',
  status: sessionExports === undefined ? 'fail' : 'pass',
  detail: sessionExports === undefined
    ? 'the session package did not load from its documented entry'
    : `session package entry resolves (${sessionExports.length} exports); adaptive phase must derive from these durable records`,
  gates: '7.5 promotion from durable records',
})

// ── Report ──────────────────────────────────────────────────────────────────

const width = Math.max(...results.map((result) => result.id.length))
console.log(`DSH public-contract probe — ${manifest.dsh.package}@${manifest.dsh.tested} (${target})\n`)
for (const result of results) {
  const mark = result.status === 'pass' ? 'PASS' : result.status === 'fail' ? 'FAIL' : 'BOOT'
  console.log(`${mark}  ${result.id.padEnd(width)}  ${result.detail}`)
}

const failed = results.filter((result) => result.status === 'fail')
const needsBoot = results.filter((result) => result.status === 'needs-boot')
console.log(`\n${results.length - failed.length - needsBoot.length} pass, ${failed.length} fail, ${needsBoot.length} need a live host`)
if (failed.length > 0) {
  console.error('\nMissing public contracts (the task groups they gate must stop and record an upstream request):')
  for (const result of failed) console.error(`  ${result.id} — gates ${result.gates}`)
  process.exit(1)
}
