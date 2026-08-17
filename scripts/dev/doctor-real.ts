import { inspectProfile, renderReport, reviewInstall, describeAuthority, AUTHORITY_WARNING } from '../../packages/plugin-governance/src/index.ts'
import { join } from 'node:path'
const home = process.env['HOME']!
const profileDir = join(home, '.dsh', 'profiles', process.argv[2] ?? 'daily-headless')
const health = inspectProfile(profileDir, process.argv[2] ?? 'daily-headless', {
  corePackages: ['@dsh-foundry/daily-bundle', '@dsh-foundry/daily-agent'],
})
console.log(renderReport(health))
console.log('\n=== 安装前权限披露(以 daily-agent 为例) ===')
const review = reviewInstall(join(profileDir, 'node_modules', '@dsh-desktop', 'daily-agent'), '@dsh-foundry/daily-agent')
for (const line of describeAuthority(review.authority)) {
  console.log(`  ${line.granted ? '授予' : ' -- '}  ${line.capability.padEnd(28)} ${line.granted ? line.meaning : ''}`)
}
console.log('\n' + AUTHORITY_WARNING)
