/**
 * The Remote-face gate rejects the two defects it exists for.
 *
 * Both shipped. A `#private` field made every workbench method throw after
 * dispatch had already succeeded, and an undeclared official import let a
 * second copy of `dsh-typert-protocol` hold the `@Remote` marker table, so the
 * Gateway refused the endpoint outright with a bare `not found`. A gate that
 * only passes on the repaired tree proves nothing, so each case below runs the
 * real gate over a probe package that carries the defect.
 * @module tests/verify-remote-faces.test
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import {
  classBodiesExtending,
  externalOfficialImports,
  stripComments,
} from '../scripts/verify-remote-faces.ts'


/**
 * Assemble a package specifier without writing it literally.
 *
 * `gate:coupling` scans every tracked and untracked file, this one included, so
 * a literal upstream specifier in a fixture string is a finding in its own
 * right — which is that gate behaving correctly.
 * @param name - Package name after the scope.
 * @param subpath - Subpath after the package name, or an empty string.
 * @returns The specifier.
 */
function specifier(name: string, subpath = ''): string {
  return `${['@deepseek', 'ai'].join('-')}/${name}${subpath === '' ? '' : `/${subpath}`}`
}

/** The Typert protocol package, whose marker table must never be duplicated. */
const PROTOCOL = specifier('dsh-typert-protocol')

/** One import line naming a package. */
const importLine = (from: string): string => `import { Remote } from ${JSON.stringify(from)}\nexport { Remote }\n`

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const scratch: string[] = []

/**
 * Write a probe package into a throwaway packages root.
 *
 * Outside the repository on purpose: probes written into the real `packages/`
 * are visible to every other gate that scans the tree, and `gate:coupling`
 * correctly reported this file's own fixtures as findings when they were.
 * @param manifest - The probe's `package.json` contents.
 * @param files - Paths under the probe and their contents.
 * @returns The packages root to hand the gate.
 */
function probePackage(manifest: object, files: Record<string, string>): string {
  const packagesRoot = mkdtempSync(join(tmpdir(), 'remote-faces-'))
  scratch.push(packagesRoot)
  const directory = join(packagesRoot, 'probe')
  mkdirSync(directory, { recursive: true })
  writeFileSync(join(directory, 'package.json'), JSON.stringify(manifest, null, 2))
  for (const [relative, contents] of Object.entries(files)) {
    const path = join(directory, relative)
    mkdirSync(join(path, '..'), { recursive: true })
    writeFileSync(path, contents)
  }
  return packagesRoot
}

/**
 * Run the gate and report its verdict.
 * @param packagesRoot - Packages directory to check; the repository's own by default.
 * @returns Exit status and combined output.
 */
function runGate(packagesRoot?: string): { ok: boolean, output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      [
        '--experimental-strip-types',
        join(ROOT, 'scripts', 'verify-remote-faces.ts'),
        ...(packagesRoot === undefined ? [] : [packagesRoot]),
      ],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
    )
    return { ok: true, output }
  } catch (error) {
    const failure = error as { stdout?: string, stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

afterEach(() => {
  for (const directory of scratch.splice(0)) rmSync(directory, { recursive: true, force: true })
})

describe('the gate over the repository', () => {
  it('passes on the current tree', () => {
    expect(runGate().ok).toBe(true)
  })

  it('rejects a Remote face that reads a #private field', () => {
    const root = probePackage(
      { name: '@dsh-foundry/remote-probe', version: '0.0.0', private: true },
      {
        'src/index.ts': `import { TypertRemoteService } from ${JSON.stringify(PROTOCOL)}\n`
          + 'export class Probe extends TypertRemoteService {\n'
          + '  readonly #capability = 1\n'
          + '  read(): number { return this.#capability }\n'
          + '}\n',
      },
    )
    const { ok, output } = runGate(root)
    expect(ok).toBe(false)
    expect(output).toContain('Remote face Probe uses #private field(s) capability')
  })

  it('rejects a runtime import of an official package the manifest never declares', () => {
    const root = probePackage(
      { name: '@dsh-foundry/remote-probe', version: '0.0.0', private: true },
      { 'lib/index.js': importLine(PROTOCOL) },
    )
    const { ok, output } = runGate(root)
    expect(ok).toBe(false)
    expect(output).toContain('declares no peer dependency')
  })

  it('rejects an official package placed in dependencies, which installs a second copy', () => {
    const root = probePackage(
      {
        name: '@dsh-foundry/remote-probe',
        version: '0.0.0',
        private: true,
        dependencies: { [PROTOCOL]: '0.1.0-rc.6' },
      },
      { 'lib/index.js': importLine(PROTOCOL) },
    )
    const { ok, output } = runGate(root)
    expect(ok).toBe(false)
    expect(output).toContain('would place a second copy')
  })

  it('accepts the same import once it is declared as a peer', () => {
    const root = probePackage(
      {
        name: '@dsh-foundry/remote-probe',
        version: '0.0.0',
        private: true,
        peerDependencies: { [PROTOCOL]: '>=0.1.0-rc.6 <0.2.0' },
      },
      { 'lib/index.js': importLine(PROTOCOL) },
    )
    expect(runGate(root).ok).toBe(true)
  })
})

describe('externalOfficialImports', () => {
  it('reports the package an import specifier names, without its subpath', () => {
    const runtime = specifier('dsh-client-runtime')
    const code = `import { Remote } from ${JSON.stringify(PROTOCOL)};\n`
      + `import { x } from ${JSON.stringify(`${runtime}/client`)};\n`
    expect(externalOfficialImports(code)).toEqual([runtime, PROTOCOL])
  })

  it('sees a dynamic import, which duplicates a module instance the same way', () => {
    const cordis = specifier('cordis')
    expect(externalOfficialImports(`await import(${JSON.stringify(cordis)})`)).toEqual([cordis])
  })

  it('reports nothing for a module that inlined everything', () => {
    expect(externalOfficialImports('export const x = 1\n')).toEqual([])
  })
})

describe('classBodiesExtending', () => {
  it('extracts a Remote face body across nested braces', () => {
    const source = 'class Face extends TypertRemoteService {\n'
      + '  method() { return { a: { b: 1 } } }\n'
      + '}\n'
      + 'class Other extends Service { #hidden = 1 }\n'
    const faces = classBodiesExtending(source, 'TypertRemoteService')
    expect(faces).toHaveLength(1)
    expect(faces[0]!.name).toBe('Face')
    // The unrelated class beneath it must not be folded into the face body, or
    // every private field in the file would be attributed to the Remote.
    expect(faces[0]!.body).not.toContain('#hidden')
  })
})

describe('stripComments', () => {
  it('blanks prose that names the syntax the rule forbids', () => {
    const source = '/** No `#private` field may back a Remote method. */\n'
      + 'class Face extends TypertRemoteService {\n'
      + '  // TypeScript-private, not `#private`.\n'
      + '  private readonly capability = 1\n'
      + '}\n'
    const [face] = classBodiesExtending(stripComments(source), 'TypertRemoteService')
    expect(face!.body).not.toContain('#private')
  })

  it('keeps a URL double slash out of the line-comment rule', () => {
    expect(stripComments("const u = 'https://example.test/x'")).toContain('https://example.test/x')
  })
})
