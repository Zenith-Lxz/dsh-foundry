/**
 * Adaptive mounting: making the first request actually Minimal, once.
 *
 * The orchestration is small and the ordering is the whole design:
 *
 * ```text
 * agent created, adaptive selected
 *   phase = minimal-first  -> mount `minimal` on the agent scope
 *                             derive identity  -> must be exactly Minimal
 *   model answers (durable assistant/message or tool/call)
 *   phase = promoted       -> recompose to `standard` + daily decoration
 * ```
 *
 * **Verification happens before the request, not after.** A first request that
 * is only approximately Minimal invalidates the comparison the experiment
 * exists to make, and nothing downstream would reveal it — so an inexact
 * derivation refuses the request rather than degrading to "close enough".
 *
 * **Promotion is idempotent and one-way.** It is driven by a phase derived from
 * durable records, so a repeated call, a resume, and a reconnect all converge on
 * the same composition instead of stacking mounts.
 * @module @dsh-foundry/daily-agent/adaptive-mount
 */
import { OFFICIAL_PRESETS } from '@dsh-foundry/daily-contract'
import { checkMinimalIdentity, derivePhase, type DerivedIdentity, type PhaseEvent } from './adaptive.ts'

/** The official services this orchestration drives, named narrowly. */
export interface AdaptiveRuntime {
  /**
   * Mount a preset onto an agent scope.
   * @param agentCtx - The agent's scoped context.
   * @param presetId - Official preset directory id.
   */
  mountPreset(agentCtx: unknown, presetId: string): Promise<void>
  /**
   * Replace an agent's mounted composition with another preset.
   * @param agentCtx - The agent's scoped context.
   * @param presetId - Official preset directory id.
   */
  recompose(agentCtx: unknown, presetId: string): Promise<void>
  /**
   * Read what the agent's scope actually assembles.
   *
   * The caller passes the agent as the ScopeKey; an implementation that omits
   * it reads the global view, which the identity gate rejects.
   * @param agent - The agent, used as the scope key.
   * @returns The derived identity.
   */
  deriveIdentity(agent: AdaptiveAgent): Promise<DerivedIdentity>
}

/** The agent fields this orchestration reads. */
export interface AdaptiveAgent {
  readonly id: string
  readonly ctx: unknown
  readonly session: { readonly events: readonly PhaseEvent[] }
}

/** Why an adaptive request was refused. */
export type AdaptiveRefusal =
  | { readonly reason: 'identity-not-exact', readonly detail: string }
  | { readonly reason: 'mount-failed', readonly detail: string }
  | { readonly reason: 'promotion-failed', readonly detail: string }

/** What preparing a request produced. */
export type AdaptivePreparation =
  | { readonly ok: true, readonly phase: 'minimal-first', readonly fingerprint: string }
  | { readonly ok: true, readonly phase: 'promoted' }
  | { readonly ok: false, readonly refusal: AdaptiveRefusal }

/**
 * Prepare an adaptive agent for its next request.
 *
 * Called before each request rather than once at creation: the phase is a
 * function of the durable log, and the log changes underneath a long-lived
 * agent. Calling it again after promotion is a cheap no-op.
 * @param agent - The adaptive agent.
 * @param runtime - The official services to drive.
 * @param promoted - Tracks agents already recomposed, so promotion happens once.
 * @returns What was prepared, or the refusal that must stop the request.
 */
export async function prepareAdaptiveRequest(
  agent: AdaptiveAgent,
  runtime: AdaptiveRuntime,
  promoted: Set<string>,
): Promise<AdaptivePreparation> {
  const phase = derivePhase(agent.session.events)

  if (phase === 'promoted') {
    if (promoted.has(agent.id)) return { ok: true, phase: 'promoted' }
    try {
      await runtime.recompose(agent.ctx, OFFICIAL_PRESETS.standard)
    } catch (error) {
      // A half-recomposed agent must not run: the catalog it would present is
      // neither Minimal nor complete, and no later record would show that.
      return {
        ok: false,
        refusal: { reason: 'promotion-failed', detail: describe(error) },
      }
    }
    promoted.add(agent.id)
    return { ok: true, phase: 'promoted' }
  }

  try {
    await runtime.mountPreset(agent.ctx, OFFICIAL_PRESETS.minimal)
  } catch (error) {
    return { ok: false, refusal: { reason: 'mount-failed', detail: describe(error) } }
  }

  const identity = await runtime.deriveIdentity(agent)
  const check = checkMinimalIdentity(identity)
  if (!check.exact) {
    return {
      ok: false,
      refusal: {
        reason: 'identity-not-exact',
        detail: `${check.mismatch}: ${check.detail}`,
      },
    }
  }
  return { ok: true, phase: 'minimal-first', fingerprint: check.fingerprint }
}

/**
 * Render a refusal for a user-facing surface.
 *
 * Names the mode, the cause, and the fact that ordinary daily mode is still
 * available — a refusal that only says "failed" leaves the user with no move.
 * @param refusal - The refusal to render.
 * @returns One actionable sentence.
 */
export function describeRefusal(refusal: AdaptiveRefusal): string {
  const cause = refusal.reason === 'identity-not-exact'
    ? `this build could not prove the first request would match official Minimal (${refusal.detail})`
    : refusal.reason === 'mount-failed'
      ? `the official Minimal composition could not be mounted (${refusal.detail})`
      : `the session could not be recomposed to the full catalog (${refusal.detail})`
  return `Adaptive mode did not start: ${cause}. Ordinary daily mode is unaffected and remains available.`
}

/**
 * Describe an error without leaking a stack into a user surface.
 * @param error - The thrown value.
 * @returns A bounded description.
 */
function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.length > 200 ? `${message.slice(0, 200)}…` : message
}
