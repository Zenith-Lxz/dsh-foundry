/**
 * The client-injection gate rejects the two defects it was written for.
 *
 * Both shipped. A `dsh.client` package whose `exports` omit `./package.json`
 * cannot have its manifest resolved by the runtime, which skips it silently —
 * the client half simply never reaches the page. And a module injecting a
 * service whose providing package is not declared loads with `apply()` never
 * running, because Cordis waits forever for a service nothing mounted.
 *
 * Neither produces an error anywhere: the bundle builds, the tests pass, the
 * tarball loads, the application launches, and the feature is absent.
 * @module tests/verify-client-inject.test
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { SERVICE_PROVIDERS, declaredInject } from '../scripts/verify-client-inject.ts'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const scratch: string[] = []

/**
 * Write a probe package under `packages/`, where the gate walks.
 * @param manifest - The probe's `package.json`.
 * @param entry - Contents of `src/client/plugin.tsx`.
 * @returns The probe directory.
 */
function probe(manifest: object, entry: string): string {
  const directory = mkdtempSync(join(ROOT, 'packages', '.inject-probe-'))
  scratch.push(directory)
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest, null, 2))
  mkdirSync(join(directory, 'src', 'client'), { recursive: true })
  writeFileSync(join(directory, 'src', 'client', 'plugin.tsx'), entry)
  return directory
}

/**
 * Run the gate.
 * @returns Exit status and combined output.
 */
function runGate(): { ok: boolean, output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', join(ROOT, 'scripts', 'verify-client-inject.ts')],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return { ok: true, output }
  } catch (error) {
    const failure = error as { stdout?: string, stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

/** A manifest that satisfies the gate, for probes to vary from. */
const sound = {
  name: '@dsh-foundry/inject-probe',
  version: '0.0.0',
  private: true,
  exports: { '.': './lib/index.js', './client': './lib/client.js', './package.json': './package.json' },
  dsh: { client: { inject: ['@deepseek-ai/dsh-client-ui-slots'], platform: 'web' } },
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('declaredInject reads the module’s own declaration', () => {
  it('extracts single and double quoted names', () => {
    expect(declaredInject(`export const inject = ['slots', "remote"]\n`)).toEqual(['slots', 'remote'])
  })

  it('reports null when the module declares none, which is not a failure', () => {
    expect(declaredInject('export function apply() {}\n')).toBeNull()
  })

  it('keeps a namespace read intact, since it needs its own inject entry', () => {
    expect(declaredInject(`export const inject = ['remote.dshWorkbench']\n`)).toEqual(['remote.dshWorkbench'])
  })
})

describe('the gate over the repository', () => {
  it('passes on the current tree', () => {
    expect(runGate().ok).toBe(true)
  })

  it('rejects a dsh.client package whose exports omit ./package.json', () => {
    // The runtime resolves the manifest with `require.resolve('<pkg>/package.json')`.
    // Node refuses that path when `exports` omits it, and the runtime catches
    // the refusal and skips the package without a word.
    const { exports: _dropped, ...rest } = sound
    probe(
      { ...rest, exports: { '.': './lib/index.js', './client': './lib/client.js' } },
      `export const inject = ['slots']\n`,
    )
    const { ok, output } = runGate()
    expect(ok).toBe(false)
    expect(output).toContain('"./package.json"')
  })

  it('rejects a module injecting a service whose provider is not declared', () => {
    probe(sound, `export const inject = ['slots', 'inputTriggers']\n`)
    const { ok, output } = runGate()
    expect(ok).toBe(false)
    expect(output).toContain(SERVICE_PROVIDERS['inputTriggers']!)
    expect(output).toContain('apply() never running')
  })

  it('rejects an injected service no known package provides', () => {
    probe(sound, `export const inject = ['slots', 'inventedService']\n`)
    const { ok, output } = runGate()
    expect(ok).toBe(false)
    expect(output).toContain('which no known package provides')
  })

  it('checks a namespace read through its owning service', () => {
    // `remote.dshWorkbench` needs `remote`'s provider declared; checking the
    // whole dotted string against the provider map would never match.
    probe(sound, `export const inject = ['slots', 'remote.dshWorkbench']\n`)
    const { ok, output } = runGate()
    expect(ok).toBe(false)
    expect(output).toContain(SERVICE_PROVIDERS['remote']!)
  })

  it('accepts a package that declares every provider it injects', () => {
    probe(
      { ...sound, dsh: { client: { inject: ['@deepseek-ai/dsh-client-ui-slots', '@deepseek-ai/dsh-api-remotes'], platform: 'web' } } },
      `export const inject = ['slots', 'remote.dshWorkbench']\n`,
    )
    expect(runGate().ok).toBe(true)
  })
})
