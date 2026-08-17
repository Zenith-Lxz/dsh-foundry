import { readFileSync } from 'node:fs'
import { projectChanges, type DurableEvent } from '../../packages/daily-workbench/src/projection.ts'
import { WorkspaceScope } from '../../packages/daily-workbench/src/workspace.ts'
import { inspectRepository } from '../../packages/daily-workbench/src/git.ts'

const [logPath, projectPath] = process.argv.slice(2)
const events: DurableEvent[] = readFileSync(logPath!, 'utf8').split('\n')
  .filter(Boolean)
  .map((line): unknown => {
    try {
      return JSON.parse(line)
    } catch {
      // One malformed line in a session log should not stop the inspection.
      return null
    }
  })
  .filter((event): event is DurableEvent =>
    event !== null && typeof event === 'object' && typeof (event as DurableEvent).seq === 'number')

const scope = new WorkspaceScope(projectPath!)
const git = await inspectRepository(scope)
const status = git.available ? git.entries : []
const p = projectChanges(events, status, scope.root)

console.log('事件数:', events.length)
console.log('\n变更归属:')
for (const c of p.changes) console.log(`  ${c.attribution.padEnd(8)} ${c.state.padEnd(10)} ${c.path}`)
console.log('\n验证证据(来自 durable 记录，不是 agent 的话):')
for (const v of p.verification) console.log(`  ${v.passed ? 'PASS' : 'FAIL'}  exit=${v.exitCode ?? '未记录'}  seq=${v.sequence}  ${v.command.slice(0,60)}`)
console.log('\n声称已改但树上没有:', p.claimedButAbsent.length ? p.claimedButAbsent.join(', ') : '(无)')
console.log('存在失败检查:', p.hasFailingCheck)
console.log('证据已过期(改动晚于检查):', p.evidenceIsStale)
