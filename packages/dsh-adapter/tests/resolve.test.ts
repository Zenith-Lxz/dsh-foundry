import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { resolveRuntime, targetKey, RuntimeResolutionError, type CompatibilityManifest } from '../src/resolve.ts'
import { collectDescendants, processFace } from '../src/platform.ts'

const manifest: CompatibilityManifest = {
  dsh: { range: '>=0.1.0-rc.6 <0.2.0', tested: '0.1.0-rc.6', package: '@deepseek-ai/dsh', bin: 'lib/bin.js' },
  readinessAdapter: { version: 1 },
  bridge: { version: 1 },
  electron: { version: '43.4.0' },
  profile: { name: 'desktop', bundle: '@dsh-foundry/bundle', bundles: [] },
  targets: {
    'darwin-arm64': {
      platform: 'darwin',
      arch: 'arm64',
      node: { version: '24.18.0', artifact: 'a.tar.xz', sha256: 'x', binary: 'bin/node' },
      acceptance: 'pending',
    },
    'win32-x64': {
      platform: 'win32',
      arch: 'x64',
      node: { version: '24.18.0', artifact: 'a.zip', sha256: 'y', binary: 'node.exe' },
      acceptance: 'unaccepted-no-host',
    },
  },
  requiredPackages: [],
  requiredSlots: [],
}

const temporaryRoots: string[] = []

/**
 * Build a stage tree for one target.
 * @param target - Target key to populate.
 * @param version - DSH version to record in the staged manifest.
 * @param options - Which parts of the stage to omit.
 * @returns The stage root holding the target directory.
 */
function makeStage(
  target: string,
  version: string,
  options: { omitNode?: boolean, omitRuntime?: boolean } = {},
): string {
  const root = mkdtempSync(join(tmpdir(), 'dsh-desktop-stage-'))
  temporaryRoots.push(root)
  const targetManifest = manifest.targets[target]
  if (targetManifest === undefined) throw new Error(`unknown target ${target}`)
  const stageDir = join(root, target)
  mkdirSync(stageDir, { recursive: true })
  if (options.omitNode !== true) {
    const nodePath = join(stageDir, 'node', targetManifest.node.binary)
    mkdirSync(join(nodePath, '..'), { recursive: true })
    writeFileSync(nodePath, '')
  }
  if (options.omitRuntime !== true) {
    const packageRoot = join(stageDir, 'runtime', 'node_modules', '@deepseek-ai', 'dsh')
    mkdirSync(join(packageRoot, 'lib'), { recursive: true })
    writeFileSync(join(packageRoot, 'lib', 'bin.js'), '')
    writeFileSync(join(packageRoot, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version }))
  }
  return root
}

afterEach(() => {
  while (temporaryRoots.length > 0) {
    const root = temporaryRoots.pop()
    if (root !== undefined) rmSync(root, { recursive: true, force: true })
  }
})

describe('resolveRuntime', () => {
  it('resolves the staged Node and official CLI entry for a matching target', () => {
    const stageRoot = makeStage('darwin-arm64', '0.1.0-rc.6')
    const resolved = resolveRuntime({ stageRoot, manifest, target: 'darwin-arm64' })
    expect(resolved.dshVersion).toBe('0.1.0-rc.6')
    expect(resolved.nodePath).toContain(join('darwin-arm64', 'node', 'bin', 'node'))
    expect(resolved.dshEntry).toContain(join('runtime', 'node_modules', '@deepseek-ai', 'dsh', 'lib', 'bin.js'))
  })

  it('refuses a target this build does not stage, naming supported and detected', () => {
    const stageRoot = makeStage('darwin-arm64', '0.1.0-rc.6')
    try {
      resolveRuntime({ stageRoot, manifest, target: 'linux-x64' })
      expect.unreachable('resolution must refuse an unsupported target')
    } catch (error) {
      expect(error).toBeInstanceOf(RuntimeResolutionError)
      expect((error as RuntimeResolutionError).code).toBe('unsupported-target')
      expect((error as Error).message).toContain('linux-x64')
      expect((error as Error).message).toContain('darwin-arm64')
    }
  })

  it('refuses the foreign-target stage rather than falling back to it', () => {
    const stageRoot = makeStage('darwin-arm64', '0.1.0-rc.6')
    try {
      resolveRuntime({ stageRoot, manifest, target: 'win32-x64' })
      expect.unreachable('a stage for another target must not satisfy this target')
    } catch (error) {
      expect((error as RuntimeResolutionError).code).toBe('stage-missing')
    }
  })

  it.each([
    [{ omitNode: true }, 'node-missing'],
    [{ omitRuntime: true }, 'runtime-missing'],
  ])('refuses an incomplete stage (%o)', (options, code) => {
    const stageRoot = makeStage('darwin-arm64', '0.1.0-rc.6', options)
    try {
      resolveRuntime({ stageRoot, manifest, target: 'darwin-arm64' })
      expect.unreachable('an incomplete stage must not resolve')
    } catch (error) {
      expect((error as RuntimeResolutionError).code).toBe(code)
    }
  })

  it('refuses a staged version outside the supported range and reports both', () => {
    const stageRoot = makeStage('darwin-arm64', '0.3.0')
    try {
      resolveRuntime({ stageRoot, manifest, target: 'darwin-arm64' })
      expect.unreachable('an unsupported version must stop startup')
    } catch (error) {
      expect((error as RuntimeResolutionError).code).toBe('version-unsupported')
      expect((error as Error).message).toContain('0.3.0')
      expect((error as Error).message).toContain('>=0.1.0-rc.6 <0.2.0')
      expect((error as Error).message).toContain('0.1.0-rc.6')
    }
  })

  it('accepts a later prerelease inside the range', () => {
    const stageRoot = makeStage('darwin-arm64', '0.1.0-rc.9')
    expect(resolveRuntime({ stageRoot, manifest, target: 'darwin-arm64' }).dshVersion).toBe('0.1.0-rc.9')
  })
})

describe('targetKey', () => {
  it('joins platform and architecture', () => {
    expect(targetKey('win32', 'x64')).toBe('win32-x64')
    expect(targetKey('darwin', 'arm64')).toBe('darwin-arm64')
  })
})

describe('processFace', () => {
  it('selects the darwin face with POSIX process-group semantics', () => {
    const face = processFace('darwin')
    expect(face.platform).toBe('darwin')
    expect(face.nodeBinaryName).toBe('node')
    expect(face.detached).toBe(true)
  })

  it('selects the win32 face with the Windows executable name', () => {
    const face = processFace('win32')
    expect(face.platform).toBe('win32')
    expect(face.nodeBinaryName).toBe('node.exe')
  })

  it('refuses a platform outside the qualification matrix', () => {
    expect(() => processFace('linux')).toThrow(/darwin and win32/)
  })
})

describe('collectDescendants', () => {
  it('collects the transitive tree, which is what quiescence is verified against', () => {
    const pairs = [[100, 1], [200, 100], [300, 200], [400, 100], [500, 999]] as const
    expect(collectDescendants(pairs.map((p) => [p[0], p[1]] as const), 100).sort()).toEqual([200, 300, 400])
  })

  it('returns nothing for a leaf process', () => {
    expect(collectDescendants([[100, 1]], 100)).toEqual([])
  })

  it('terminates on a cyclic table rather than looping forever', () => {
    expect(collectDescendants([[100, 200], [200, 100]], 100)).toEqual([200])
  })
})
