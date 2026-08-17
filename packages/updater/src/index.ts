/**
 * Updating the Harness runtime and the distribution without re-downloading the
 * application.
 *
 * Read [plan](./plan.ts): it holds the rule that a Harness candidate must pass
 * the extension-point probe before it is ever offered.
 * @module @dsh-foundry/updater
 */
export { compareVersions, decide, describeDecision, satisfiesRange } from './plan.ts'
export type { Candidate, Decision, ProbeResult, RejectionReason, UpdateTarget } from './plan.ts'
