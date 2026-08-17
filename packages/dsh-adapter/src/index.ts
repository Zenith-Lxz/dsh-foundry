/**
 * The DSH adaptation surface: everything the companion application knows about
 * how the official runtime is located, started, observed, and stopped.
 *
 * An upstream version bump is absorbed here or, failing that, in the native
 * bridge or the desktop layout package — never by editing official code.
 * @module @dsh-foundry/adapter
 */
export { ReadinessParser } from './readiness.ts'
export type { ReadinessOutcome, ReadinessRejection } from './readiness.ts'
export { processFace, collectDescendants } from './platform.ts'
export type { ProcessFace } from './platform.ts'
export { redact, OutputTail, splitLines } from './diagnostics.ts'
export {
  readCompatibilityManifest,
  resolveRuntime,
  targetKey,
  RuntimeResolutionError,
} from './resolve.ts'
export type { CompatibilityManifest, ResolvedRuntime, TargetManifest } from './resolve.ts'
export {
  DshSupervisor,
  GRACEFUL_STOP_TIMEOUT_MS,
  ESCALATION_TIMEOUT_MS,
  READINESS_TIMEOUT_MS,
} from './supervisor.ts'
export type {
  ExitClassification,
  HostState,
  ShutdownReport,
  SupervisorOptions,
} from './supervisor.ts'
