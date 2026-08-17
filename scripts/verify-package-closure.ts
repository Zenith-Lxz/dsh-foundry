/**
 * `pnpm run verify:closure` — prove every companion tarball can actually load.
 *
 * The failure this exists to prevent already shipped: a packaged release died
 * at first launch with `ERR_MODULE_NOT_FOUND` for
 * `@dsh-foundry/daily-workbench/lib/gateway.js`. The cause was a build race —
 * `tsc --build` emitted unbundled per-file JavaScript into the same `lib/` the
 * bundler writes, so whichever ran last decided whether `lib/index.js` was a
 * self-contained bundle or a file importing siblings the `files` allowlist
 * never packed. Every workspace check passed, because every workspace check
 * read `src`.
 *
 * So this verifies the **tarball**, not the workspace:
 *
 * 1. pack each companion exactly as the packager will,
 * 2. extract it to a clean directory,
 * 3. `import()` every public export with plain Node,
 * 4. walk the extracted tree for relative runtime imports that resolve nowhere.
 *
 * Step 3 is the one that matters. A missing module is only discoverable by
 * asking Node to load the file the way the Harness will.
 * @module scripts/verify-package-closure
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { pathToFileURL } from 'node:url'

const REPOSITORY_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)))

/** One problem found in a packed tarball. */
export interface ClosureProblem {
  readonly packageName: string
  readonly problem: string
}

/**
 * Collect the Node entry files a package's `exports` map points at.
 *
 * Two kinds are excluded, both because loading them in Node would report a
 * failure the product never has:
 *
 * - **Type conditions.** A `.d.ts` is never loaded at run time.
 * - **Browser halves.** A client bundle references `window`; the Harness loads
 *   it in a page, and Node rejecting it says nothing about the tarball. Their
 *   file closure is still walked, which is where a missing sibling would show.
 * @param manifest - The package manifest.
 * @returns Relative entry paths that Node is expected to load.
 */
export function runtimeEntries(manifest: {
  main?: unknown
  exports?: unknown
}): string[] {
  const entries = new Set<string>()
  const visit = (value: unknown): void => {
    if (typeof value === 'string') {
      if (value.endsWith('.js') || value.endsWith('.mjs') || value.endsWith('.cjs')) entries.add(value)
      return
    }
    if (value === null || typeof value !== 'object') return
    for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'types' || key === './client' || key.endsWith('/client')) continue
      visit(nested)
    }
  }
  visit(manifest.exports)
  if (typeof manifest.main === 'string') entries.add(manifest.main)
  return [...entries]
}

/**
 * Find relative imports in a file that resolve to nothing.
 *
 * Only static specifiers are read. A dynamic import built from a variable
 * cannot be checked here, and pretending otherwise would report false
 * confidence rather than a false failure.
 * @param file - Absolute path of the JavaScript file.
 * @returns Specifiers that do not resolve.
 */
export function unresolvedRelativeImports(file: string): string[] {
  const source = readFileSync(file, 'utf8')
  const missing: string[] = []
  const pattern = /(?:from|import)\s*\(?\s*['"](\.[^'"]*)['"]/g
  for (const match of source.matchAll(pattern)) {
    const specifier = match[1]
    if (specifier === undefined) continue
    const target = resolve(dirname(file), specifier)
    const candidates = [target, `${target}.js`, `${target}.mjs`, join(target, 'index.js')]
    if (!candidates.some((candidate) => existsSync(candidate))) missing.push(specifier)
  }
  return missing
}

/**
 * List every JavaScript file under a directory.
 * @param root - Directory to walk.
 * @returns Absolute file paths.
 */
function javascriptFiles(root: string): string[] {
  const found: string[] = []
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory)) {
      const path = join(directory, entry)
      if (statSync(path).isDirectory()) walk(path)
      else if (/\.(js|mjs|cjs)$/.test(entry)) found.push(path)
    }
  }
  walk(root)
  return found
}

/**
 * Pack a package and verify the tarball's contents load.
 * @param packageDir - Repository-relative package directory.
 * @param packDir - Where to write tarballs.
 * @returns Problems found, empty when the tarball is sound.
 */
export async function verifyPackage(packageDir: string, packDir: string): Promise<ClosureProblem[]> {
  const manifest = JSON.parse(
    readFileSync(join(REPOSITORY_ROOT, packageDir, 'package.json'), 'utf8'),
  ) as { name: string, main?: unknown, exports?: unknown }
  const problems: ClosureProblem[] = []
  const note = (problem: string): void => {
    problems.push({ packageName: manifest.name, problem })
  }

  const output = execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
    cwd: join(REPOSITORY_ROOT, packageDir),
    encoding: 'utf8',
  })
  const tarball = output.trim().split('\n').at(-1)
  if (tarball === undefined || !existsSync(tarball)) {
    note('pnpm pack produced no tarball')
    return problems
  }

  // Extracted beneath the package's own `node_modules` so Node resolves its
  // declared dependencies exactly as an installed profile does. pnpm installs
  // in isolated layout, so a package's dependencies exist only under that
  // package; extracting anywhere else reports every external import as missing,
  // which is a property of the test location rather than of the tarball.
  const closureRoot = join(REPOSITORY_ROOT, packageDir, 'node_modules', '.closure')
  mkdirSync(closureRoot, { recursive: true })
  const extracted = mkdtempSync(join(closureRoot, 'pkg-'))
  try {
    execFileSync('tar', ['-xzf', tarball, '-C', extracted], { stdio: 'pipe' })
    const root = join(extracted, 'package')

    for (const entry of runtimeEntries(manifest)) {
      const file = join(root, entry)
      if (!existsSync(file)) {
        // The exact failure that shipped: declared by `exports`, absent from
        // the tarball because `files` did not list it.
        note(`entry ${entry} is declared by exports but missing from the tarball`)
        continue
      }
      try {
        await import(pathToFileURL(file).href)
      } catch (error) {
        note(`entry ${entry} failed to import: ${error instanceof Error ? error.message : String(error)}`)
      }
    }

    for (const file of javascriptFiles(root)) {
      for (const specifier of unresolvedRelativeImports(file)) {
        note(`${file.slice(root.length + 1)} imports ${specifier}, which is not in the tarball`)
      }
    }
  } finally {
    rmSync(extracted, { recursive: true, force: true })
  }
  return problems
}

const packages = process.argv.slice(2).filter((argument) => !argument.startsWith('-'))
const targets = packages.length > 0
  ? packages
  : readdirSync(join(REPOSITORY_ROOT, 'packages'))
    .map((name) => `packages/${name}`)
    .filter((relative) => {
      const manifestPath = join(REPOSITORY_ROOT, relative, 'package.json')
      if (!existsSync(manifestPath)) return false
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as { name?: string }
      return manifest.name?.startsWith('@dsh-foundry/') === true
    })

const packDir = mkdtempSync(join(REPOSITORY_ROOT, 'node_modules', '.closure-pack-'))
const allProblems: ClosureProblem[] = []
for (const target of targets) {
  const problems = await verifyPackage(target, packDir)
  allProblems.push(...problems)
  console.log(problems.length === 0 ? `✓ ${target}` : `✗ ${target}`)
  for (const problem of problems) console.error(`    ${problem.problem}`)
}
rmSync(packDir, { recursive: true, force: true })

console.log(`\n${allProblems.length === 0 ? 'PASS' : 'FAIL'} — ${targets.length} package(s) verified from their tarballs`)
if (allProblems.length > 0) process.exitCode = 1
