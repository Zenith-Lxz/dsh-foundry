/**
 * `pnpm run doctor:gate` — verify the doctor against a provisioned profile.
 *
 * Separate from `doctor` because the release gate must be deterministic: run
 * against the developer's own Harness home it would pass or fail on whatever
 * profiles happen to be installed there, which says nothing about this build.
 * This provisions a clean home through the official plugin command and checks
 * the report the doctor produces from it.
 * @module scripts/doctor-gate
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDoctor } from '../packages/plugin-governance/src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8')) as {
  profile: { companionPackages?: readonly string[] }
}

const home = mkdtempSync(join(tmpdir(), 'foundry-doctor-'))
const packDir = mkdtempSync(join(tmpdir(), 'foundry-doctor-pack-'))
const failures: string[] = []

try {
  const tarballs = ['packages/daily-contract', 'packages/daily-agent'].map((relative) => {
    const output = execFileSync('pnpm', ['pack', '--pack-destination', packDir], {
      cwd: join(root, relative),
      encoding: 'utf8',
    })
    return output.trim().split('\n').at(-1)!
  })
  execFileSync(
    join(root, 'stage', 'darwin-arm64', 'runtime', 'node_modules', '.bin', 'dsh'),
    ['plugin', '--profile', 'doctor-gate', 'add', ...tarballs],
    { env: { ...process.env, DSH_HOME: home }, stdio: 'pipe' },
  )

  const result = runDoctor({
    home,
    tiers: { corePackages: [...(manifest.profile.companionPackages ?? [])] },
  })
  const check = (condition: boolean, name: string): void => {
    console.log(`${condition ? '✓' : '✗'} ${name}`)
    if (!condition) failures.push(name)
  }

  check(result.profiles.includes('doctor-gate'), 'the provisioned profile is discovered')
  check(result.healthy, 'the provisioned profile reports healthy')
  check(result.report.includes('@dsh-foundry/daily-agent'), 'the report names the installed companion')
  check(
    result.report.includes('do not apply to plugin code or to MCP servers'),
    'the report carries the plugin authority warning',
  )
  check(result.report.includes('composition, not behavior'), 'the report states its own blind spot')
} finally {
  rmSync(home, { recursive: true, force: true })
  rmSync(packDir, { recursive: true, force: true })
}

console.log(`\n${failures.length === 0 ? 'PASS' : 'FAIL'} — doctor verified against a provisioned profile`)
if (failures.length > 0) process.exitCode = 1
