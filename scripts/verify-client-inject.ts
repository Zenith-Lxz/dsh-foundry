/**
 * `pnpm run verify:inject` — every injected service has a declared provider.
 *
 * A client plugin lists the services it needs twice: `inject` in the module,
 * and the packages providing them in `dsh.client.inject`. When the two disagree
 * the plugin's `apply` never runs — Cordis waits forever for a service nothing
 * loaded — and **nothing reports it**. The `@file` menu shipped dead this way:
 * the module injected `remote` while the manifest never named the package that
 * provides it, so `registerSource` was never called and typing `@` did nothing.
 *
 * Nothing else catches this. The bundle builds, the tests pass, the tarball
 * loads, and the packaged application launches; the feature is simply absent.
 * @module scripts/verify-client-inject
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Cordis service names each official package provides to the browser.
 *
 * Read from the packages themselves would be ideal, but a provider registers
 * its name at runtime; this map is the declared correspondence, and a service
 * missing from it fails loudly rather than passing unchecked.
 */
export const SERVICE_PROVIDERS: Readonly<Record<string, string>> = {
  slots: '@deepseek-ai/dsh-client-ui-slots',
  theme: '@deepseek-ai/dsh-client-ui-theme',
  remote: '@deepseek-ai/dsh-api-remotes',
  inputTriggers: '@deepseek-ai/dsh-client-ui-input-trigger',
  sessions: '@deepseek-ai/dsh-client-runtime',
  locale: '@deepseek-ai/dsh-client-locale',
  workspace: '@deepseek-ai/dsh-client-ui-workspace',
  settings: '@deepseek-ai/dsh-client-ui-settings',
}

/**
 * Read the `inject` array a client module exports.
 * @param source - Module source text.
 * @returns Injected service names, or `null` when the module declares none.
 */
export function declaredInject(source: string): string[] | null {
  const match = /export const inject\s*=\s*\[([^\]]*)\]/.exec(source)
  if (match === null) return null
  return [...match[1]!.matchAll(/'([^']+)'|"([^"]+)"/g)].map((entry) => entry[1] ?? entry[2]!)
}

const problems: string[] = []
for (const name of readdirSync(join(REPOSITORY_ROOT, 'packages'))) {
  const packageDir = join(REPOSITORY_ROOT, 'packages', name)
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    dsh?: { client?: { inject?: string[] } }
  }
  const declaredPackages = manifest.dsh?.client?.inject
  if (declaredPackages === undefined) continue

  const entry = ['src/client/plugin.tsx', 'src/client/index.tsx', 'src/client/index.ts']
    .map((relative) => join(packageDir, relative))
    .find((path) => existsSync(path))
  if (entry === undefined) {
    problems.push(`${manifest.name!}: declares dsh.client but has no client entry`)
    continue
  }

  // The runtime resolves a client package's manifest with `require.resolve` of
  // `<pkg>/package.json`. Node refuses that path when `exports` omits it, and
  // the runtime catches the refusal and skips the package silently — the client
  // half simply never reaches the page. This shipped once: adding `./typert`
  // rewrote the export map and dropped `./package.json` with it.
  const exportsField = (JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exports?: Record<string, unknown>
  }).exports
  if (exportsField?.['./package.json'] === undefined) {
    problems.push(
      `${manifest.name!}: declares dsh.client but its exports omit "./package.json". `
      + 'The runtime cannot resolve its manifest, skips it without an error, and the client half never loads.',
    )
  }

  const injected = declaredInject(readFileSync(entry, 'utf8'))
  if (injected === null) continue

  for (const service of injected) {
    // A namespace read like `remote.dshWorkbench` needs its own inject entry;
    // Cordis refuses the property read otherwise. Its provider is the owning
    // service, which is checked through the part before the dot.
    const provider = SERVICE_PROVIDERS[service.split('.')[0]!]
    if (provider === undefined) {
      problems.push(`${manifest.name!}: injects "${service}", which no known package provides`)
      continue
    }
    if (!declaredPackages.includes(provider)) {
      problems.push(
        `${manifest.name!}: injects "${service}" but dsh.client.inject omits ${provider}. `
        + 'The plugin would load with apply() never running, and nothing would report it.',
      )
    }
  }
  console.log(`✓ ${manifest.name!} — ${injected.length} injected service(s) all have declared providers`)
}

for (const problem of problems) console.error(`✗ ${problem}`)
console.log(`\n${problems.length === 0 ? 'PASS' : 'FAIL'} — client injection declarations`)
if (problems.length > 0) process.exitCode = 1
