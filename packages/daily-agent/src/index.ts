/**
 * Daily mode: agent-scoped decoration of the official Standard preset.
 *
 * The distribution does not copy Standard, does not maintain a second tool or
 * plugin list, and does not replace the agent loop. It observes the official
 * `agent/created` event, asks the official record which preset the session
 * runs, and — only for Standard agents — mounts its additions on that agent's
 * own scoped context.
 *
 * Three public contracts carry this, all resolved against the published runtime
 * by `scripts/probe-dsh-contracts.ts`:
 *
 * - `agent/created` / `agent/disposed` — scope-filtered lifecycle events.
 * - `Agent.ctx` — "agent-scoped context; its contributions are agent-local,
 *   unwind on disposal, and reject registration afterward".
 * - `resolveSessionPreset(session)` — the official answer to which preset a
 *   session actually runs, newest selection winning over the creation header.
 *
 * Because every registration is made through `agent.ctx`, disposal is the
 * runtime's job rather than this package's bookkeeping: when the agent goes,
 * the additions go, and a sibling session running Minimal or PTC never sees
 * them. That is what keeps mode isolation a property of the composition instead
 * of a filter this code has to remember to apply.
 * @module @dsh-foundry/daily-agent
 */
import { resolveSessionPreset } from '@deepseek-ai/dsh-agent-presets'
import { DAILY_BASE_PRESET } from '@dsh-foundry/daily-contract'
import { DAILY_SECTION_NAME, DAILY_SECTION_ORDER, instructionsFor } from './instructions.ts'
import { describeRefusal, prepareAdaptiveRequest, type AdaptiveRuntime } from './adaptive-mount.ts'

/**
 * The subset of the official agent this package reads.
 *
 * Declared structurally rather than imported as the full `Agent` type: this
 * package needs an identity, the durable session record, and the scoped
 * context, and naming exactly that keeps the surface it depends on visible.
 */
export interface DecoratableAgent {
  readonly id: string
  readonly session: {
    readonly header: unknown
    readonly events: readonly unknown[]
  }
  readonly ctx: {
    systemPrompt: {
      section(section: { name: string, order: number, text: string }): () => void
    }
    effect(callback: () => (() => void) | void, label?: string): () => void
  }
}

/** A step decision, as the official pre-step waterfall defines it. */
export type StepDecision = { kind: 'reject' } | { kind: 'enter', messages: unknown[] }

/** What the host plugin needs from the surrounding context. */
export interface DailyHost {
  /**
   * Subscribe to a scope-filtered official event.
   * @param event - Event name.
   * @param listener - Listener receiving the payload.
   * @returns The disposer.
   */
  on(event: 'agent/created', listener: (payload: { agent: DecoratableAgent }) => void): () => void
  /**
   * Subscribe to the pre-step waterfall.
   *
   * A listener must call `next()` to delegate; returning without it
   * short-circuits the chain, which is how adaptive rejects a step before the
   * model runs.
   * @param event - Event name.
   * @param listener - Waterfall listener.
   * @returns The disposer.
   */
  /** Surface an adaptive refusal to the user; absent in a headless host. */
  reportAdaptiveRefusal?(message: string): void
  on(
    event: 'agent/pre-step',
    listener: (
      payload: { agent: DecoratableAgent },
      next: () => Promise<StepDecision>,
    ) => Promise<StepDecision>,
  ): () => void
}

/** Configuration for the daily decorator. */
export interface DailyConfig {
  /**
   * Whether daily decoration is active for this profile.
   *
   * The Bundle mounts this package only in daily profiles, so the flag exists
   * for a user or test to turn the decoration off and observe unchanged
   * official Standard behavior without editing the composition.
   */
  readonly enabled?: boolean
  /**
   * Which instruction variant to mount.
   *
   * Exists so the standing instructions can be compared under the same corpus
   * rather than changed on judgement. `full` is the default until a controlled
   * result justifies otherwise.
   */
  readonly variant?: string
  /**
   * Decorate agents in a composition that mounts no agent presets at all.
   *
   * **Off by default, and that default is the safety property.** In a shared
   * profile the user switches presets, so an undecorated preset must stay
   * undecorated — and a composition that reports no preset is indistinguishable
   * from one whose preset could not be resolved.
   *
   * A dedicated single-purpose profile is the exception: the headless
   * qualification profile composes no preset roster at all, because its agents
   * are built directly rather than from a preset. There the profile itself is
   * the selection, so there is no user choice to protect.
   */
  readonly decorateWhenNoPreset?: boolean
  /**
   * Enable the opt-in adaptive experiment for this profile.
   *
   * Off by default and gated twice: this flag, and a per-session selection. The
   * evaluation that would justify making it a default has not been run, so an
   * accidental enable must not be possible from configuration alone.
   */
  readonly adaptive?: boolean
  /**
   * Sessions that selected adaptive, by session id.
   *
   * Supplied by the surface that owns the selection; the plugin does not invent
   * one, so a profile-level flag can never silently opt an ordinary session into
   * the experiment.
   */
  readonly adaptiveSessions?: readonly string[]
}

/**
 * Decide whether an agent should receive daily decoration.
 *
 * Only official Standard, by default. Minimal is a benchmark composition whose
 * whole point is its fixed prompt; PTC and Creator are different presentations
 * the user selected on purpose; a user-authored preset is a complete
 * composition this distribution has no license to edit.
 * @param agent - The newly created agent.
 * @param config - Decoration policy for this profile.
 * @returns True when the agent should receive daily behavior.
 */
export function isDailyTarget(agent: DecoratableAgent, config: DailyConfig = {}): boolean {
  // The header records the preset a session STARTED with, but a blank session
  // may switch; the official resolver folds the later selection over it, which
  // is why the header is never read directly here.
  const preset = resolveSessionPreset({
    header: agent.session.header as never,
    events: agent.session.events as never,
  })
  if (preset === undefined) return config.decorateWhenNoPreset === true
  return preset === DAILY_BASE_PRESET
}

/**
 * Mount daily behavior on one agent.
 *
 * Registration goes through `agent.ctx`, so the returned disposer is a
 * convenience for tests: the runtime already unwinds these contributions when
 * the agent is disposed.
 * @param agent - The agent to decorate.
 * @param variant - Instruction variant; the default applies when absent.
 * @returns A disposer withdrawing the daily additions.
 */
export function decorateAgent(agent: DecoratableAgent, variant?: string): () => void {
  return agent.ctx.effect(() => {
    const disposeSection = agent.ctx.systemPrompt.section({
      name: DAILY_SECTION_NAME,
      order: DAILY_SECTION_ORDER,
      text: instructionsFor(variant),
    })
    return () => {
      disposeSection()
    }
  }, 'daily-agent: standard decoration')
}

/** Required services; the loader waits for these before applying. */
export const inject = ['systemPrompt']

/**
 * Host plugin body.
 *
 * Mounting is per agent rather than once for the process: a host runs many
 * agents concurrently, and a process-global mode flag would leak one session's
 * presentation into another's request.
 * @param ctx - Host root context.
 * @param config - Plugin configuration.
 * @returns A disposer withdrawing the lifecycle subscription.
 */
export function apply(ctx: DailyHost, config: DailyConfig = {}, runtime?: AdaptiveRuntime): () => void {
  if (config.enabled === false) return () => {}

  const disposers: (() => void)[] = [
    ctx.on('agent/created', ({ agent }) => {
      if (!isDailyTarget(agent, config)) return
      decorateAgent(agent, config.variant)
    }),
  ]

  // Adaptive needs a runtime to drive; without one the experiment stays off
  // rather than half-installed.
  if (config.adaptive === true && runtime !== undefined) {
    const selected = new Set(config.adaptiveSessions ?? [])
    const promoted = new Set<string>()
    disposers.push(ctx.on('agent/pre-step', async ({ agent }, next) => {
      if (!selected.has(agent.id)) return next()
      const prepared = await prepareAdaptiveRequest(
        { id: agent.id, ctx: agent.ctx, session: { events: agent.session.events as never } },
        runtime,
        promoted,
      )
      if (prepared.ok) return next()
      // Rejecting here is the point: the step never reaches the model, so a
      // catalog that is neither Minimal nor complete cannot be presented.
      ctx.reportAdaptiveRefusal?.(describeRefusal(prepared.refusal))
      return { kind: 'reject' }
    }))
  }

  return () => {
    for (const dispose of disposers) dispose()
  }
}

export {
  MINIMAL_SECTION_NAME,
  MINIMAL_TOOL_NAMES,
  canChangeMode,
  checkMinimalIdentity,
  derivePhase,
  fingerprintIdentity,
  isAdaptivePhase,
} from './adaptive.ts'
export type { DerivedIdentity, IdentityCheck, IdentityMismatch, PhaseEvent } from './adaptive.ts'
export { describeRefusal, prepareAdaptiveRequest } from './adaptive-mount.ts'
export type {
  AdaptiveAgent,
  AdaptivePreparation,
  AdaptiveRefusal,
  AdaptiveRuntime,
} from './adaptive-mount.ts'
export {
  DAILY_INSTRUCTIONS,
  DAILY_VARIANTS,
  instructionsFor,
  DAILY_SECTION_NAME,
  DAILY_SECTION_ORDER,
  DAILY_SECTION_TOKEN_BUDGET,
  estimateTokens,
} from './instructions.ts'
