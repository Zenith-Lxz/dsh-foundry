/**
 * `pnpm run mechanics` — run the keyless deterministic suite.
 *
 * Runs on every release. A missing model credential downgrades the reported
 * claim to `unrun`; it never downgrades this gate.
 * @module scripts/mechanics
 */
import { spawnSync } from 'node:child_process'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  applicableChecks,
  modelEvaluationBlocker,
  renderMechanics,
  summarize,
  undeclaredScripts,
  type MechanicsResult,
} from '../packages/daily-eval/src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const manifest = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')) as { scripts: Record<string, string> }
const undeclared = undeclaredScripts(Object.keys(manifest.scripts))
if (undeclared.length > 0) {
  console.error(`the suite names scripts this package does not declare: ${undeclared.join(', ')}`)
  process.exit(2)
}
const results: MechanicsResult[] = []

for (const check of applicableChecks(process.platform)) {
  process.stdout.write(`→ ${check.id} … `)
  const startedAt = Date.now()
  const run = spawnSync('pnpm', ['run', check.script], { cwd: root, encoding: 'utf8' })
  const durationMs = Date.now() - startedAt
  const outcome = run.status === 0 ? 'pass' : 'fail'
  results.push({
    id: check.id,
    outcome,
    detail: outcome === 'pass' ? check.establishes : `${run.stdout ?? ''}${run.stderr ?? ''}`.trim().slice(-600),
    durationMs,
  })
  console.log(`${outcome} (${(durationMs / 1000).toFixed(1)}s)`)
}

const verdict = summarize(process.platform, results, modelEvaluationBlocker())
const evidenceDir = join(root, 'evidence', `${process.platform}-${process.arch}`)
mkdirSync(evidenceDir, { recursive: true })
writeFileSync(join(evidenceDir, 'mechanics.md'), renderMechanics(verdict))
console.log(`\n${verdict.passed ? 'PASS' : 'FAIL'} — evidence written to evidence/${process.platform}-${process.arch}/mechanics.md`)
for (const result of verdict.results) {
  if (result.outcome === 'fail') console.error(`\n${result.id}:\n${result.detail}`)
}
if (!verdict.passed) process.exitCode = 1
