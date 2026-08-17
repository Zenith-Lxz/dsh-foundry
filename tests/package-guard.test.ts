/**
 * Packaging refuses a stage whose native modules were never compiled.
 *
 * `nativeComplete` was read, printed into the log, and never consulted. A
 * cross-staged target installs its modules with `--os --cpu --ignore-scripts`,
 * so nothing is compiled and no postinstall runs; packaging it anyway produces
 * a release-shaped artifact that fails at run time in ways indistinguishable
 * from product defects — and, once it leaves the build machine, from an
 * accepted build.
 * @module tests/package-guard.test
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))

/**
 * Run the packaging script and capture its refusal.
 * @param args - Arguments after the script path.
 * @returns Exit status and combined output.
 */
function runPackager(args: readonly string[]): { ok: boolean, output: string } {
  try {
    const output = execFileSync(
      process.execPath,
      ['--experimental-strip-types', join(ROOT, 'scripts', 'package-app.ts'), ...args],
      { cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 60_000 },
    )
    return { ok: true, output }
  } catch (error) {
    const failure = error as { stdout?: string, stderr?: string }
    return { ok: false, output: `${failure.stdout ?? ''}${failure.stderr ?? ''}` }
  }
}

describe('an incomplete stage cannot be packaged by accident', () => {
  const windowsStage = join(ROOT, 'stage', 'win32-x64', 'stage.json')

  it.skipIf(!existsSync(windowsStage))('refuses the cross-staged Windows target', () => {
    const descriptor = JSON.parse(readFileSync(windowsStage, 'utf8')) as { nativeComplete: boolean }
    // Guard the guard: if the stage ever becomes native-complete on this host,
    // this case is testing nothing and should say so rather than pass quietly.
    expect(descriptor.nativeComplete, 'the Windows stage is cross-staged on this host').toBe(false)

    const { ok, output } = runPackager(['win32-x64'])
    expect(ok).toBe(false)
    expect(output).toContain('nativeComplete: false')
    expect(output).toContain('--build-candidate')
  })

  it('rejects an unknown target before reading any stage', () => {
    const { ok, output } = runPackager(['freebsd-riscv'])
    expect(ok).toBe(false)
    expect(output).toContain('unknown target')
  })

  it('states its usage when given no target', () => {
    const { ok, output } = runPackager([])
    expect(ok).toBe(false)
    expect(output).toContain('usage: package-app.ts')
  })
})
