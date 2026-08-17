/**
 * A bounded same-model pilot.
 *
 * Runs a small subset of the corpus under two official compositions to prove
 * the evaluation pipeline works end to end against a live model. This is a
 * pilot, not the qualifying sweep: it is deliberately small because every run
 * spends real money, and a full sweep is 40 tasks x 5 configurations x 3
 * repetitions.
 *
 * Usage: `pnpm run pilot [--tasks N] [--profiles a,b]`
 * @module scripts/pilot
 */
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  buildReport,
  dshDriver,
  loadCorpus,
  officialDecoder,
  renderReport,
  runCorpus,
  type AgentDriver,
  type RunRecord,
} from '../packages/daily-eval/src/index.ts'

const root = fileURLToPath(new URL('..', import.meta.url))
const corpusRoot = join(root, 'corpus')
const corpus = loadCorpus(corpusRoot)

const taskArgument = process.argv.find((argument) => argument.startsWith('--tasks='))
const taskCount = taskArgument === undefined ? 3 : Number(taskArgument.slice('--tasks='.length))
const profileArgument = process.argv.find((argument) => argument.startsWith('--profiles='))
const profiles = (profileArgument?.slice('--profiles='.length) ?? 'daily-headless,baseline-headless').split(',')
const repetitionArgument = process.argv.find((argument) => argument.startsWith('--reps='))
const repetitions = repetitionArgument === undefined ? 1 : Number(repetitionArgument.slice('--reps='.length))

const manifest = JSON.parse(readFileSync(join(root, 'compatibility.json'), 'utf8')) as {
  dsh: { tested: string, package: string }
  targets: Record<string, { node: { binary: string } }>
}
const target = `${process.platform}-${process.arch}`
const stageDir = join(root, 'stage', target)
const dshBin = join(stageDir, 'runtime', 'node_modules', '.bin', 'dsh')

// A template home carrying the user's profiles and credential store, so runs
// stay isolated from each other without this script ever reading the secret.
const templateHome = mkdtempSync(join(tmpdir(), 'dsh-pilot-template-'))
const realHome = join(homedir(), '.dsh')
cpSync(join(realHome, 'profiles'), join(templateHome, 'profiles'), { recursive: true })
for (const file of ['.credentials.yaml', 'settings.yaml']) {
  try {
    cpSync(join(realHome, file), join(templateHome, file))
  } catch {
    // Absent on a machine with no configured credential; the run then fails
    // with an authentication invalidation, which is the correct record.
  }
}

const decode = officialDecoder(
  await import(join(stageDir, 'runtime', 'node_modules', '@deepseek-ai', 'dsh-session', 'lib', 'index.js')),
)

const scratchDir = mkdtempSync(join(tmpdir(), 'dsh-pilot-homes-'))
const drivers: AgentDriver[] = profiles.map((profile) => dshDriver({
  identity: {
    lane: 'same-model',
    configuration: profile.replace(/-headless$/, '').replace('baseline', 'standard'),
    productVersion: '0.1.0',
    model: 'configured-default',
    reasoningEffort: null,
    platform: process.platform,
    architecture: process.arch,
    dshVersion: manifest.dsh.tested,
  },
  dshBin,
  profile,
  templateHome,
  scratchDir,
  decode,
}))

const tasks = corpus.tasks.filter((task) => task.platforms.includes(process.platform)).slice(0, taskCount)
console.log(`pilot: ${tasks.length} task(s) x ${drivers.length} configuration(s) x ${repetitions} repetition(s)\n`)

const records: RunRecord[] = await runCorpus({
  tasks,
  drivers,
  corpusRoot,
  repetitions,
  onRun: (record) => {
    const verdict = record.invalidation !== null
      ? `INVALID (${record.invalidation.cause})`
      : record.verifiedSuccess === true ? 'verified' : 'not verified'
    console.log(
      `  ${record.identity.configuration.padEnd(9)} ${record.taskId.padEnd(42)} ${verdict}`
      + `  requests=${record.metrics.modelRequests ?? '-'}`
      + ` tools=${record.metrics.toolCalls ?? '-'}`
      + ` tokens=${record.metrics.inputTokens ?? '-'}/${record.metrics.outputTokens ?? '-'}`,
    )
  },
})

mkdirSync(join(root, 'evidence'), { recursive: true })
writeFileSync(join(root, 'evidence', 'pilot-runs.json'), `${JSON.stringify(records, null, 2)}\n`)

const report = buildReport({
  corpusVersion: corpus.version,
  tasks,
  runs: records,
  deterministicPassed: [process.platform],
  claims: [],
  modelEvaluationUnrun: null,
})
writeFileSync(join(root, 'evidence', 'pilot-report.md'), renderReport(report))
console.log('\nwrote evidence/pilot-runs.json and evidence/pilot-report.md')
