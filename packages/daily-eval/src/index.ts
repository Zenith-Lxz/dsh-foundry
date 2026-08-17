/**
 * Coding evaluation for the distribution.
 *
 * Read [schema](./schema.ts) first: it defines what a run is and what makes a
 * comparison claim expire. [metrics](./metrics.ts) holds the promotion rule,
 * [report](./report.ts) renders results, and [mechanics](./mechanics.ts) is the
 * keyless suite that runs on every release whether or not a model credential
 * exists.
 * @module @dsh-foundry/daily-eval
 */
export {
  EVAL_LANES,
  EVAL_SCHEMA_VERSION,
  INVALIDATION_CAUSES,
  MINIMUM_CORPUS_SIZE,
  MINIMUM_REPETITIONS,
  MINIMUM_TASKS_PER_CATEGORY,
  NO_METRICS,
  TASK_CATEGORIES,
  checkCoverage,
  claimIsExpired,
  identityDrift,
} from './schema.ts'
export type {
  ComparisonClaim,
  ConfigurationIdentity,
  EvalLane,
  InvalidationCause,
  RunMetrics,
  RunRecord,
  TaskCategory,
  TaskManifest,
} from './schema.ts'
export {
  ALLOWED_TOKEN_INCREASE,
  REQUIRED_IMPROVEMENT,
  REQUIRED_PLATFORMS,
  aggregate,
  evaluatePromotion,
  median,
  totalTokens,
} from './metrics.ts'
export type { Aggregate, PromotionVerdict } from './metrics.ts'
export { buildReport, renderReport } from './report.ts'
export type { EvalReport, ReportInput } from './report.ts'
export {
  MECHANICS_SUITE,
  applicableChecks,
  modelEvaluationBlocker,
  renderMechanics,
  summarize,
  undeclaredScripts,
} from './mechanics.ts'
export type { MechanicsCheck, MechanicsResult, MechanicsVerdict } from './mechanics.ts'
export { countByCategory, loadCorpus, tasksForPlatform } from './corpus.ts'
export type { CorpusProblem, LoadedCorpus } from './corpus.ts'
export {
  ORACLE_EVIDENCE_LIMIT,
  ORACLE_FILES,
  changedPaths,
  diffLineCount,
  oracleAcceptsSolution,
  oracleRejectsPristine,
  outOfScopeWrites,
  provision,
  runOracle,
} from './workspace.ts'
export type { OracleResult, Workspace } from './workspace.ts'
export { assembleMetrics, readResumeOutcome, readSessionFacts } from './session-metrics.ts'
export type { SessionEvent, SessionFacts } from './session-metrics.ts'
export { classifyFailure, planRuns, runCorpus, runOnce } from './runner.ts'
export type { AgentDriver, DriverOutcome, RunOptions } from './runner.ts'
export { officialDecoder, readSessionLog } from './session-log.ts'
export type { ReadLogResult, RecordDecoder } from './session-log.ts'
export { dshDriver, findSessionLog, invalidationFromOutput } from './driver-dsh.ts'
export type { DshLaneConfig } from './driver-dsh.ts'
export {
  BOOTSTRAP_SAMPLES,
  describeInterval,
  pairOutcomes,
  pairedSuccessInterval,
  provenWorse,
  seededRandom,
} from './paired.ts'
export type { Interval, PairedOutcome } from './paired.ts'
