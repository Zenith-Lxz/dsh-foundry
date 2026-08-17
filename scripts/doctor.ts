/**
 * `pnpm run doctor` — report what is installed in the Harness home.
 * @module scripts/doctor
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { runDoctor } from '../packages/plugin-governance/src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8')) as {
  profile: { companionPackages?: readonly string[] }
}

const profileArgument = process.argv.find((argument) => argument.startsWith('--profile='))
// An explicit home makes the release gate deterministic. Without it the gate
// would pass or fail on whatever profiles the developer happens to have, which
// is environment state rather than product state.
const homeArgument = process.argv.find((argument) => argument.startsWith('--home='))
const result = runDoctor({
  ...(profileArgument === undefined ? {} : { profile: profileArgument.slice('--profile='.length) }),
  ...(homeArgument === undefined ? {} : { home: homeArgument.slice('--home='.length) }),
  tiers: { corePackages: [...(manifest.profile.companionPackages ?? []), '@dsh-foundry/daily-bundle', '@dsh-foundry/daily-agent'] },
})

console.log(`Harness home: ${result.harnessHome}`)
console.log(`profiles: ${result.profiles.join(', ') || '(none)'}\n`)
console.log(result.report)
if (!result.healthy) process.exitCode = 1
