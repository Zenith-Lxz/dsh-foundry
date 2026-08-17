/**
 * Adaptive presentation: the opt-in Minimal-first experiment.
 *
 * An adaptive session sends its **first** model request under the exact official
 * Minimal identity — that persona and those two tools — and then, once the model
 * has actually responded, exposes the complete daily catalog for every request
 * after it.
 *
 * Two properties make this safe to build rather than merely plausible:
 *
 * - **The identity is derived, never copied.** `tools.schemas(agent)` and
 *   `systemPrompt.assemble({ scope: agent })` return whatever the installed
 *   release assembles for the mounted `minimal` preset. A snapshot in this
 *   repository would drift from the runtime and quietly stop being Minimal.
 * - **The phase is derived, never stored.** It is a function of the durable
 *   session log. There is no private event, no sidecar file, and nothing to
 *   resynchronize after a resume — a restored session recomputes the same phase
 *   from the same records.
 *
 * Promotion happens exactly once and never reverses: a session that has seen
 * the full catalog does not go back to two tools, because the trajectory the
 * model is continuing was produced under the larger one.
 * @module @dsh-foundry/daily-agent/adaptive
 */
import { ADAPTIVE_PHASES, type AdaptivePhase } from '@dsh-foundry/daily-contract'

/** The official Minimal tool names, in the order the schemas report them. */
export const MINIMAL_TOOL_NAMES: readonly string[] = ['bash', 'str_replace_editor']

/** The single prompt section an assembled Minimal identity contains. */
export const MINIMAL_SECTION_NAME = 'deployment:persona'

/** A durable record, narrowed to what phase derivation reads. */
export interface PhaseEvent {
  readonly type: string
}

/**
 * Derive the adaptive phase from durable session records.
 *
 * The rule is the whole mechanism: a session is `minimal-first` until the log
 * contains an `assistant/message` or a `tool/call`, and `promoted` from then on.
 * Either record means the model already answered under the Minimal catalog, so
 * the benchmark condition the experiment cares about has been satisfied and the
 * session should get its real capabilities.
 *
 * A failed tool still promotes: the model *chose* a tool from the Minimal
 * catalog, which is the observation being made. Whether the command then
 * succeeded says nothing about the presentation.
 * @param events - Durable session events, in any order.
 * @returns The phase this session's next request runs under.
 */
export function derivePhase(events: readonly PhaseEvent[]): AdaptivePhase {
  for (const event of events) {
    if (event.type === 'assistant/message' || event.type === 'tool/call') return 'promoted'
  }
  return 'minimal-first'
}

/** What a live derivation observed, for comparison against the expected identity. */
export interface DerivedIdentity {
  /** Tool names visible in the agent's scope. */
  readonly toolNames: readonly string[]
  /** Prompt section names assembled for the agent's scope. */
  readonly sectionNames: readonly string[]
  /** The assembled prompt text. */
  readonly promptText: string
}

/** Why a derived identity was rejected as not-Minimal. */
export type IdentityMismatch =
  | 'tool-count'
  | 'tool-names'
  | 'section-count'
  | 'section-name'
  | 'empty-prompt'

/** The outcome of checking a derived identity. */
export type IdentityCheck =
  | { readonly exact: true, readonly fingerprint: string }
  | { readonly exact: false, readonly mismatch: IdentityMismatch, readonly detail: string }

/**
 * Check that a derived identity is exactly official Minimal.
 *
 * This is the gate the whole experiment rests on. An *approximately* Minimal
 * first request is worse than no experiment: the comparison it exists to make
 * would be silently invalid, and no downstream number would reveal that.
 *
 * The most likely real failure is a scoping mistake rather than an upstream
 * change — an omitted scope reads the global catalog, and a composition that
 * mounts the agent plane globally contaminates the reading. Both surface here as
 * a tool-count mismatch rather than as a subtly wrong request.
 * @param derived - What the live derivation observed.
 * @returns Exactness plus a fingerprint, or the mismatch that disqualified it.
 */
export function checkMinimalIdentity(derived: DerivedIdentity): IdentityCheck {
  if (derived.toolNames.length !== MINIMAL_TOOL_NAMES.length) {
    return {
      exact: false,
      mismatch: 'tool-count',
      detail: `expected ${MINIMAL_TOOL_NAMES.length} tools, derived ${derived.toolNames.length}`
        + ' — an omitted ScopeKey reads the global catalog, and a composition that mounts the agent'
        + ' plane globally contaminates the reading',
    }
  }
  const derivedTools = [...derived.toolNames].sort()
  const expectedTools = [...MINIMAL_TOOL_NAMES].sort()
  if (derivedTools.some((name, index) => name !== expectedTools[index])) {
    return {
      exact: false,
      mismatch: 'tool-names',
      detail: `expected [${expectedTools.join(', ')}], derived [${derivedTools.join(', ')}]`,
    }
  }
  if (derived.sectionNames.length !== 1) {
    return {
      exact: false,
      mismatch: 'section-count',
      detail: `expected one complete section, derived ${derived.sectionNames.length}`
        + ' — Minimal declares a complete persona, which collapses the assembly to a single section',
    }
  }
  if (derived.sectionNames[0] !== MINIMAL_SECTION_NAME) {
    return {
      exact: false,
      mismatch: 'section-name',
      detail: `expected ${MINIMAL_SECTION_NAME}, derived ${derived.sectionNames[0] ?? '(none)'}`,
    }
  }
  if (derived.promptText.trim().length === 0) {
    return { exact: false, mismatch: 'empty-prompt', detail: 'the assembled prompt is empty' }
  }
  return { exact: true, fingerprint: fingerprintIdentity(derived) }
}

/**
 * Fingerprint a derived identity.
 *
 * Recorded against the exact DSH version so a later release that changes
 * Minimal is detected as a change rather than absorbed silently. Content-based
 * rather than a stored copy: the fingerprint proves what was observed without
 * becoming a second source of truth for what Minimal *is*.
 * @param derived - The derived identity.
 * @returns A stable fingerprint string.
 */
export function fingerprintIdentity(derived: DerivedIdentity): string {
  const tools = [...derived.toolNames].sort().join(',')
  const text = derived.promptText.trim()
  let hash = 0
  for (let index = 0; index < text.length; index += 1) {
    hash = (Math.imul(hash, 31) + text.charCodeAt(index)) | 0
  }
  return `tools:${tools}|prompt:${(hash >>> 0).toString(16)}|len:${text.length}`
}

/** Why a mode change was refused. */
export type ModeChangeRefusal = 'already-requested'

/**
 * Decide whether a session may still change presentation mode.
 *
 * Allowed only before the first model request. After it, the session's
 * trajectory was produced under one presentation, and reinterpreting that
 * history under another is not a mode change but a different session — which is
 * why the caller is told to fork rather than being quietly allowed.
 * @param events - Durable session events.
 * @returns Whether the change is allowed, and why not when it is refused.
 */
export function canChangeMode(events: readonly PhaseEvent[]):
  | { readonly allowed: true }
  | { readonly allowed: false, readonly refusal: ModeChangeRefusal, readonly remedy: string } {
  if (derivePhase(events) === 'minimal-first') return { allowed: true }
  return {
    allowed: false,
    refusal: 'already-requested',
    remedy: 'create a new session or fork this one; the existing trajectory was produced under its current presentation',
  }
}

/**
 * Report whether a phase is a known member of the closed set.
 * @param value - Candidate.
 * @returns True when it is a declared phase.
 */
export function isAdaptivePhase(value: unknown): value is AdaptivePhase {
  return ADAPTIVE_PHASES.some((phase) => phase === value)
}
