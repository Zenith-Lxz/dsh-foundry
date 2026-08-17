/**
 * `pnpm run eval:report` — generate the evaluation report.
 *
 * Runs with or without model results. Without them the report states that model
 * evaluation is unrun and that the corpus is below its floors, which is the
 * point: an absent measurement must read as absent, not as a pass.
 * @module scripts/eval-report
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  loadCorpus,
  modelEvaluationBlocker,
  renderReport,
  type RunRecord,
} from '../packages/daily-eval/src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const corpus = loadCorpus(join(root, 'corpus'))
const resultsFile = join(root, 'evidence', 'runs.json')
const runs: RunRecord[] = existsSync(resultsFile)
  ? (JSON.parse(readFileSync(resultsFile, 'utf8')) as RunRecord[])
  : []

const mechanicsFile = join(root, 'evidence', `${process.platform}-${process.arch}`, 'mechanics.md')
const deterministicPassed = existsSync(mechanicsFile) && readFileSync(mechanicsFile, 'utf8').includes('result: PASS')
  ? [process.platform]
  : []

const report = buildReport({
  corpusVersion: corpus.version,
  tasks: corpus.tasks,
  runs,
  deterministicPassed,
  claims: [],
  modelEvaluationUnrun: runs.length === 0
    ? (modelEvaluationBlocker() ?? 'No run results were recorded, so no model-dependent task has been evaluated.')
    : null,
})

const outputDir = join(root, 'evidence')
mkdirSync(outputDir, { recursive: true })
writeFileSync(join(outputDir, 'evaluation.md'), renderReport(report))
writeFileSync(join(outputDir, 'evaluation.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(`wrote evidence/evaluation.md (${runs.length} run(s), corpus version ${corpus.version})`)
