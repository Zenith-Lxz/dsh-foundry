/**
 * `pnpm run verify:remotes` — a Remote face the official Gateway can invoke.
 *
 * Two invariants, both of which failed silently in a shipped build. Neither is
 * caught by typecheck, unit tests, the tarball closure check, or the packaged
 * smoke: the plugin loads, the service registers, and only a live call fails.
 *
 * **1. Runtime imports of official packages are peer dependencies.** A profile
 * resolves `@deepseek-ai/*` through the link farm the Harness seeds at
 * `<home>/profiles/node_modules`, which points at the single staged runtime
 * copy. A `dependencies` entry defeats that: pnpm installs a *second* copy into
 * the profile, and any module-private state then exists twice. The Typert
 * `@Remote` marker table is exactly such state — a `WeakMap` private to
 * `dsh-typert-protocol` — so decorators write into one copy while the Gateway's
 * `remoteMethods()` reads the other, finds no markers, and refuses the endpoint
 * with a bare `not found`. An undeclared import is the same hazard one step
 * earlier: nothing pins which copy resolution lands on.
 *
 * **2. No `#private` field backs a Remote face.** The Gateway invokes a Remote
 * with `this` bound to the Cordis service *proxy*, not to the instance. An
 * ECMAScript private field is reachable only from the object whose class
 * declared it, so the call throws `Cannot read private member … from an object
 * whose class did not declare it` *after* dispatch succeeded. No official
 * Remote face uses `#private`; this makes that convention enforceable.
 * @module scripts/verify-remote-faces
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/**
 * Directory holding the packages to check.
 *
 * Defaults to this repository's `packages/`. The gate's own regression tests
 * pass a fixture directory instead: writing probe packages into the real tree
 * would race every other gate that scans it, and a gate that can only be tested
 * by mutating the repository cannot be tested at all in parallel.
 */
const PACKAGES_ROOT = process.argv[2] ?? join(REPOSITORY_ROOT, 'packages')

/** Scope whose packages resolve to the staged runtime and must never be duplicated. */
export const OFFICIAL_SCOPE = '@deepseek-ai/'

/**
 * Package names imported at runtime by a built module.
 *
 * Reads the built output rather than the source, because a bundler decides what
 * stays external — an import the source writes may be inlined, and one it never
 * writes may appear through an inlined dependency. Only what survives bundling
 * can duplicate a module instance.
 * @param code - Built JavaScript.
 * @returns Official package names the module imports, without subpaths.
 */
export function externalOfficialImports(code: string): string[] {
  const found = new Set<string>()
  for (const match of code.matchAll(/(?:from|import)\s*\(?\s*['"](@deepseek-ai\/[^'"]+)['"]/g)) {
    const specifier = match[1]!
    const segments = specifier.split('/')
    found.add(`${segments[0]!}/${segments[1]!}`)
  }
  return [...found].sort()
}

/**
 * Remove comments so prose about a rule is never read as a breach of it.
 *
 * The class contract documenting why `#private` is forbidden names the syntax
 * it forbids, and an uncommented scan flags the documentation itself.
 * @param source - Source text.
 * @returns The same text with block and line comments blanked.
 */
export function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/[^\n]*/g, '$1')
}

/**
 * Extract the body of every class extending a given base.
 * @param source - TypeScript source text.
 * @param base - Base class name.
 * @returns One entry per class, with its name and body text.
 */
export function classBodiesExtending(source: string, base: string): { name: string, body: string }[] {
  const bodies: { name: string, body: string }[] = []
  const header = new RegExp(`class\\s+(\\w+)\\s+extends\\s+${base}\\s*\\{`, 'g')
  for (const match of source.matchAll(header)) {
    let depth = 1
    let index = match.index + match[0].length
    const start = index
    while (index < source.length && depth > 0) {
      const character = source[index]!
      if (character === '{') depth += 1
      else if (character === '}') depth -= 1
      index += 1
    }
    bodies.push({ name: match[1]!, body: source.slice(start, index - 1) })
  }
  return bodies
}

/** Source files to scan for Remote faces. */
function sourceFiles(directory: string): string[] {
  if (!existsSync(directory)) return []
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [path] : []
  })
}

const problems: string[] = []
let checked = 0

for (const name of readdirSync(PACKAGES_ROOT)) {
  const packageDir = join(PACKAGES_ROOT, name)
  const manifestPath = join(packageDir, 'package.json')
  if (!existsSync(manifestPath)) continue
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    name?: string
    dependencies?: Record<string, string>
    peerDependencies?: Record<string, string>
  }
  const packageName = manifest.name ?? name

  // Invariant 1 — over the built Host entry, which is what a profile loads.
  const built = join(packageDir, 'lib', 'index.js')
  if (existsSync(built)) {
    checked += 1
    const peers = Object.keys(manifest.peerDependencies ?? {})
    const runtimeDependencies = Object.keys(manifest.dependencies ?? {})
    for (const imported of externalOfficialImports(readFileSync(built, 'utf8'))) {
      if (runtimeDependencies.includes(imported)) {
        problems.push(
          `${packageName}: lists ${imported} in "dependencies". A profile install would place a second copy `
          + 'beside the staged runtime one, and module-private state (the Typert marker table) would exist twice. '
          + 'Declare it in "peerDependencies" instead.',
        )
        continue
      }
      if (!peers.includes(imported)) {
        problems.push(
          `${packageName}: imports ${imported} at runtime but declares no peer dependency on it. `
          + 'Nothing pins which copy the profile resolves.',
        )
      }
    }
  }

  // Invariant 2 — over the source, where the field is declared.
  for (const path of sourceFiles(join(packageDir, 'src'))) {
    const source = stripComments(readFileSync(path, 'utf8'))
    if (!source.includes('TypertRemoteService')) continue
    for (const face of classBodiesExtending(source, 'TypertRemoteService')) {
      checked += 1
      const privates = [...face.body.matchAll(/(?:^|[^\w$.])#(\w+)/g)].map((match) => match[1]!)
      if (privates.length === 0) continue
      problems.push(
        `${packageName}: Remote face ${face.name} uses #private field(s) ${[...new Set(privates)].join(', ')}. `
        + 'The Gateway invokes Remote methods on the Cordis service proxy, which cannot read them: the call '
        + 'throws after dispatch has already succeeded. Use a TypeScript-private property.',
      )
    }
  }
}

for (const problem of problems) console.error(`✗ ${problem}`)
console.log(`\n${problems.length === 0 ? 'PASS' : 'FAIL'} — Remote faces (${checked} checked)`)
if (problems.length > 0) process.exitCode = 1
