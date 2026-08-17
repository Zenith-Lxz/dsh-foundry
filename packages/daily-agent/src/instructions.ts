/**
 * The stable daily instruction section.
 *
 * This text is the entire model-visible addition daily mode makes to an
 * official Standard agent. It is deliberately short and stable for two reasons:
 * it sits in the request prefix, so churn invalidates cache on every turn, and
 * a long standing instruction competes with the task the user actually asked
 * for.
 *
 * What belongs here is only what applies to **every** repository turn. Anything
 * language-, framework-, or workflow-specific belongs in a Skill, loaded
 * through the official catalog when the task matches it — that keeps the
 * specialized guidance independently maintainable and out of the prefix.
 * @module @dsh-foundry/daily-agent/instructions
 */

/** Section name; a duplicate registration in one scope throws by contract. */
export const DAILY_SECTION_NAME = 'daily:repository-practice'

/**
 * Render order.
 *
 * After the deployment persona (`0`) and before tool guidance (`100`): daily
 * policy qualifies the persona rather than replacing it, and must not displace
 * the tool instructions the official catalog contributes.
 */
export const DAILY_SECTION_ORDER = 50

/**
 * The stable daily instructions.
 *
 * Each line states an obligation the agent can act on, not an aspiration.
 * Ordering is deliberate: ground the work, protect what you did not touch,
 * bound the authority, then define what "done" is allowed to mean.
 */
const FULL_TEXT = `## Working in this repository

Before material edits, read the applicable repository instructions and inspect the code, tests, and change state you will affect. Resolve discoverable facts with tools instead of asking.

Preserve state you were not asked to change: never reset, stash, clean, reformat, stage, commit, or overwrite unrelated work as a side effect.

Prefer the project's own commands, scripts, and patterns over new ones.

A coding request authorizes inspection and scoped edits. It does not authorize commit, push, pull requests, publication, deployment, credential changes, or deleting data — stop and hand off.

Verify with the narrowest project-owned checks that cover your change, then inspect the diff. Report the commands you ran and what they returned.

Where those checks do not cover what you changed, say so and test the boundaries rather than the happy path: the first and last accepted value, one just outside each end, and whatever your documentation claims. A check that only exercises what you just wrote is not evidence.

Separate what you implemented, what you verified, and what you did not. A check you did not run is not evidence, and a passing check is not release acceptance.`

/**
 * The section without the boundary-testing paragraph.
 *
 * Kept as a selectable variant rather than deleted, because the paragraph's
 * value is an empirical question this repository can now answer: it was added
 * on one uncontrolled before/after observation, and the first controlled sweep
 * showed it costing about 11% more tokens for no verified-success gain. Both
 * texts stay measurable so the decision rests on a comparison rather than on
 * whichever anecdote was most recent.
 */
const LEAN_TEXT = FULL_TEXT.replace(
  /Where those checks do not cover[\s\S]*?is not evidence\.\n\n/,
  '',
)

/** Selectable instruction variants. */
export const DAILY_VARIANTS = { full: FULL_TEXT, lean: LEAN_TEXT } as const

/** One instruction variant. */
export type DailyVariant = keyof typeof DAILY_VARIANTS

/**
 * The default instruction text.
 *
 * **`lean`, changed on evidence.** A three-way sweep of 360 runs over corpus v2
 * measured `full` at 89.2% verified against 92.5% for the official Standard
 * composition, while `lean` reached 91.7% at baseline cost. The
 * boundary-testing paragraph was not merely expensive — it lost bug-repair and
 * multi-file-feature tasks the same model solved without it.
 *
 * That paragraph had been added on a single uncontrolled before/after
 * observation. This default may move again, but only the same way: a controlled
 * result, never a preference.
 */
export const DAILY_INSTRUCTIONS = DAILY_VARIANTS.lean

/**
 * Resolve the instruction text for a variant.
 * @param variant - Requested variant; unknown values fall back to the default.
 * @returns The instruction text.
 */
export function instructionsFor(variant: string | undefined): string {
  return variant !== undefined && variant in DAILY_VARIANTS
    ? DAILY_VARIANTS[variant as DailyVariant]
    : DAILY_INSTRUCTIONS
}

/**
 * Approximate the section's request-prefix cost.
 *
 * A rough character-derived estimate is enough for its only purpose: failing a
 * test when the standing instructions grow past their budget. It is not a
 * tokenizer and must not be reported as an exact token count.
 * @param text - Section text.
 * @returns Estimated tokens, biased high so the budget errs toward being strict.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 3.5)
}

/**
 * Budget for the standing daily addition, in estimated tokens.
 *
 * The number is a guard against drift rather than a measured optimum: the
 * section is re-sent on every request in the session, so growth here is paid
 * continuously and should require a deliberate decision.
 *
 * Raised from 300 once, deliberately. A real run produced range-matching code
 * with no lower bound while its self-authored check reported success — the
 * agent had tested what it wrote rather than what the range meant. The
 * boundary-testing paragraph that closes that gap earned the extra space; the
 * rest of the section was compressed to pay for as much of it as possible.
 */
export const DAILY_SECTION_TOKEN_BUDGET = 360
