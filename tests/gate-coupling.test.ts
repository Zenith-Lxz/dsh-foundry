import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const scratch: string[] = []

/**
 * Write a file inside the repository and return its repo-relative path.
 *
 * The gate walks tracked and untracked files, so a probe has to live in the
 * tree it inspects.
 * @param contents - File contents.
 * @param under - Repository-relative directory to place the probe in.
 * @returns Repository-relative path of the probe.
 */
function probe(contents: string, under = '.'): string {
  const directory = mkdtempSync(join(ROOT, under, '.gate-probe-'))
  scratch.push(directory)
  const file = join(directory, 'probe.ts')
  writeFileSync(file, contents)
  return file.slice(ROOT.length)
}

/**
 * Assemble an import line without writing the specifier literally.
 *
 * The gate scans every tracked and untracked file, this one included, so a
 * literal probe specifier here would be a finding in its own right — which is
 * the gate behaving correctly.
 * @param scope - Package scope.
 * @param name - Package name.
 * @param subpath - Subpath after the package name, or an empty string.
 * @returns One import statement.
 */
function importLine(scope: string, name: string, subpath: string): string {
  const specifier = `${scope}/${name}${subpath === '' ? '' : `/${subpath}`}`
  return `import { probeValue } from '${specifier}'\n`
}

const SCOPE = ['@deepseek', 'ai'].join('-')

/**
 * Run the gate and return its combined output and exit status.
 * @returns The gate's verdict.
 */
function runGate(): { readonly passed: boolean, readonly output: string } {
  try {
    const output = execFileSync('node', ['--experimental-strip-types', 'scripts/gate-coupling.ts'], {
      cwd: ROOT,
      encoding: 'utf8',
    })
    return { passed: true, output }
  } catch (error) {
    const failure = error as { stdout?: string, stderr?: string }
    return { passed: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('the clean tree passes', () => {
  it('reports no coupling', () => {
    expect(runGate().passed).toBe(true)
  })
})

describe('documented subpaths are read from the package, not a fixed list', () => {
  it('accepts a subpath the package actually exports', () => {
    // `./tsdown` is declared by the typert generator. A hardcoded allowlist
    // rejected this and pushed toward widening the rule instead.
    probe(importLine(SCOPE, 'dsh-typert-generator', 'tsdown'))
    expect(runGate().passed).toBe(true)
  })

  it('accepts a client subpath resolved from a package-local install', () => {
    // pnpm installs a package's own devDependencies beneath it, so resolution
    // must walk up from the importing file rather than only check the root.
    probe(importLine(SCOPE, 'dsh-client-ui-conversation', 'client'), 'packages/daily-workbench')
    expect(runGate().passed).toBe(true)
  })

  it('rejects a subpath the package does not export', () => {
    probe(importLine(SCOPE, 'dsh-typert-generator', 'not-an-export'))
    expect(runGate().passed).toBe(false)
  })

  it('rejects a subpath of a package that is not installed at all', () => {
    // Unresolvable is not proof of a documented export; a typo must still fail.
    probe(importLine(SCOPE, 'dsh-no-such-package', 'client'))
    expect(runGate().passed).toBe(false)
  })

  it('still rejects a reach into lib', () => {
    probe(importLine(SCOPE, 'dsh-typert-generator', 'lib/index.js'))
    expect(runGate().passed).toBe(false)
  })
})

describe('the upstream checkout stays unreachable', () => {
  it('rejects a path into the reference repository', () => {
    const result = (() => {
      const upstream = ['deepseek', 'harness'].join('-')
      probe(`export const probePath = '${upstream}/packages/core/src/index.ts'\n`)
      return runGate()
    })()
    expect(result.passed).toBe(false)
    expect(result.output).toMatch(/upstream-checkout-path/)
  })
})
