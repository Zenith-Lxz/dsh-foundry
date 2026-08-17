/**
 * `pnpm run verify:oracles` — prove every oracle rejects its untouched fixture.
 *
 * Keyless and deterministic. Without this, a corpus can report a perfect score
 * for work that was never done.
 * @module scripts/verify-oracles
 */
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  checkCoverage,
  loadCorpus,
  oracleAcceptsSolution,
  oracleRejectsPristine,
} from '../packages/daily-eval/src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const corpusRoot = join(root, 'corpus')
const corpus = loadCorpus(corpusRoot)

let failed = corpus.problems.length > 0
for (const problem of corpus.problems) console.error(`✗ ${problem.taskId}: ${problem.problem}`)

for (const task of corpus.tasks) {
  if (!task.platforms.includes(process.platform)) {
    console.log(`- ${task.id} (not applicable on ${process.platform})`)
    continue
  }
  // Both directions, because either alone is satisfiable by a useless oracle.
  const rejects = oracleRejectsPristine(task, corpusRoot)
  const accepts = oracleAcceptsSolution(task, corpusRoot)
  if (rejects === null && accepts === null) {
    console.log(`✓ ${task.id} — rejects the untouched fixture, accepts the reference solution`)
  } else {
    if (rejects !== null) console.error(`✗ ${task.id}: ${rejects}`)
    if (accepts !== null) console.error(`✗ ${task.id}: ${accepts}`)
    failed = true
  }
}

const coverage = checkCoverage(corpus.tasks)
if (coverage.length > 0) {
  console.log(`\ncorpus coverage is below the required floors (${coverage.length} shortfalls); reports state this:`)
  for (const problem of coverage) console.log(`  - ${problem}`)
}

console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${corpus.tasks.length} task(s), corpus version ${corpus.version}`)
if (failed) process.exitCode = 1
