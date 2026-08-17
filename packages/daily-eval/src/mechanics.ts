/**
 * The keyless deterministic mechanics suite.
 *
 * Everything that does not depend on a model answer — installation,
 * composition, security, permissions, session and resume handling, workbench
 * behavior, plugin governance, lifecycle — is verified here, and this suite runs
 * on every release whether or not a paid credential exists.
 *
 * The rule it enforces is that a missing credential downgrades the *claim*, not
 * the *gate*: with no key, model evaluation is reported as `unrun` and the
 * mechanics suite still has to pass. A suite that quietly skipped itself would
 * make a release with no evidence indistinguishable from one that passed.
 * @module @dsh-foundry/daily-eval/mechanics
 */

/** One deterministic check and how to run it. */
export interface MechanicsCheck {
  readonly id: string
  /** What this check establishes, stated as the fact it proves. */
  readonly establishes: string
  /** Package script to run. */
  readonly script: string
  /** Platforms the check is meaningful on; empty means all. */
  readonly platforms: readonly NodeJS.Platform[]
}

/**
 * The suite.
 *
 * Ordered cheapest-first so a composition mistake surfaces before a packaging
 * run spends minutes proving the same thing.
 */
export const MECHANICS_SUITE: readonly MechanicsCheck[] = [
  {
    id: 'coupling',
    establishes: 'no private coupling to the upstream checkout exists in any tracked or untracked file',
    script: 'gate:coupling',
    platforms: [],
  },
  {
    id: 'lint',
    establishes: 'no unexplained `any`, floating promise, or loose equality reaches the tree, with every exception narrowed and justified at its site',
    script: 'lint',
    platforms: [],
  },
  {
    id: 'unit',
    establishes: 'every package behaves as its tests describe',
    script: 'test',
    platforms: [],
  },
  {
    id: 'typecheck',
    establishes: 'every package compiles under strict TypeScript against the pinned DSH types',
    script: 'typecheck',
    platforms: [],
  },
  {
    id: 'probe',
    establishes: 'every public DSH extension point this distribution depends on exists in the pinned version',
    script: 'probe:contracts',
    platforms: [],
  },
  {
    id: 'qualify-profile',
    establishes: 'the desktop profile installs through the official plugin command and drops no official row',
    script: 'qualify:profile',
    platforms: [],
  },
  {
    id: 'qualify-daily',
    establishes: 'the daily profile decorates the live official Standard preset without disabling any official row',
    script: 'qualify:daily',
    platforms: [],
  },
  {
    id: 'qualify-desktop-daily',
    establishes: 'daily composes inside the desktop profile without changing what the shell owns, and the whole product still composes with the native bridge disabled',
    script: 'qualify:desktop-daily',
    platforms: [],
  },
  {
    id: 'oracles',
    establishes: 'every corpus oracle rejects its untouched fixture and accepts its reference solution',
    script: 'verify:oracles',
    platforms: [],
  },
  {
    id: 'bundle',
    establishes: 'every package produces its declared runtime entries from the bundler, not from a type-check side effect',
    script: 'bundle',
    platforms: [],
  },
  {
    id: 'inject',
    establishes: 'every service a client plugin injects has its providing package declared, so no plugin can load with apply() never running',
    script: 'verify:inject',
    platforms: [],
  },
  {
    id: 'closure',
    establishes: 'every companion tarball loads under plain Node with no missing module, verified from the packed artifact rather than from src',
    script: 'verify:closure',
    platforms: [],
  },
  {
    id: 'remotes',
    establishes: 'every Remote face is invocable through the official Gateway: no #private field it cannot read on the service proxy, and no official import that a profile could resolve to a second copy',
    script: 'verify:remotes',
    platforms: [],
  },
  {
    id: 'window',
    establishes: 'the live packaged window applies its declared policy: no Node reachable, no Electron global exposed, window-open and webview attachment denied, and the layout resolving without overflow at every qualified width',
    script: 'verify:window',
    platforms: ['darwin'],
  },
  {
    id: 'doctor',
    establishes: 'the doctor reports composition and authority correctly from a freshly provisioned profile, independent of the developer machine',
    script: 'doctor:gate',
    platforms: [],
  },
]

/** What one check produced. */
export interface MechanicsResult {
  readonly id: string
  readonly outcome: 'pass' | 'fail' | 'not-applicable'
  readonly detail: string
  readonly durationMs: number
}

/** The suite's verdict on one platform. */
export interface MechanicsVerdict {
  readonly platform: NodeJS.Platform
  readonly passed: boolean
  readonly results: readonly MechanicsResult[]
  /** Why model evaluation did not run, or `null` when it did. */
  readonly modelEvaluationUnrun: string | null
}

/**
 * Decide whether model evaluation can run.
 *
 * Separated from the suite because the answer changes the *report*, not the
 * gate: the suite must pass either way.
 * @param environment - Environment variables to read.
 * @returns The reason model evaluation cannot run, or `null` when it can.
 */
export function modelEvaluationBlocker(environment: NodeJS.ProcessEnv = process.env): string | null {
  const key = environment['DEEPSEEK_API_KEY']
  if (key === undefined || key.trim().length === 0) {
    return 'No DEEPSEEK_API_KEY was available, so no model-dependent task ran. '
      + 'Model evaluation is UNRUN — not passed, and not skipped as acceptable.'
  }
  return null
}

/**
 * Check that every script the suite names actually exists.
 *
 * A typo in a script name would otherwise surface as a failed check, which
 * reads as "the product is broken" rather than "the suite is misconfigured".
 * @param scripts - Script names declared by the package manifest.
 * @returns Names the suite references but the manifest does not declare.
 */
export function undeclaredScripts(scripts: readonly string[]): string[] {
  return MECHANICS_SUITE.map((check) => check.script).filter((script) => !scripts.includes(script))
}

/**
 * Select the checks that apply to a platform.
 * @param platform - The host platform.
 * @returns The applicable checks.
 */
export function applicableChecks(platform: NodeJS.Platform): MechanicsCheck[] {
  return MECHANICS_SUITE.filter(
    (check) => check.platforms.length === 0 || check.platforms.includes(platform),
  )
}

/**
 * Summarize results into a verdict.
 * @param platform - The host platform.
 * @param results - Results from the applicable checks.
 * @param modelBlocker - Why model evaluation did not run, when it did not.
 * @returns The verdict.
 */
export function summarize(
  platform: NodeJS.Platform,
  results: readonly MechanicsResult[],
  modelBlocker: string | null,
): MechanicsVerdict {
  const applicable = applicableChecks(platform)
  const ran = new Set(results.map((result) => result.id))
  const unrun = applicable.filter((check) => !ran.has(check.id))
  const augmented = [
    ...results,
    // An unrun check is a failure, not an omission: treating it as neutral is
    // exactly how a suite comes to pass without having verified anything.
    ...unrun.map((check): MechanicsResult => ({
      id: check.id,
      outcome: 'fail',
      detail: 'check did not run',
      durationMs: 0,
    })),
  ]
  return {
    platform,
    passed: augmented.every((result) => result.outcome !== 'fail'),
    results: augmented,
    modelEvaluationUnrun: modelBlocker,
  }
}

/**
 * Render a verdict for a release log.
 * @param verdict - The verdict to render.
 * @returns Markdown text.
 */
export function renderMechanics(verdict: MechanicsVerdict): string {
  const lines = [
    `# Deterministic mechanics — ${verdict.platform}`,
    '',
    `result: ${verdict.passed ? 'PASS' : 'FAIL'}`,
    '',
    'check | outcome | duration | establishes',
    '--- | --- | --- | ---',
  ]
  for (const result of verdict.results) {
    const check = MECHANICS_SUITE.find((entry) => entry.id === result.id)
    lines.push([
      result.id,
      result.outcome,
      `${(result.durationMs / 1000).toFixed(1)}s`,
      check?.establishes ?? result.detail,
    ].join(' | '))
  }
  if (verdict.modelEvaluationUnrun !== null) {
    lines.push('', '## Model evaluation: UNRUN', '', verdict.modelEvaluationUnrun)
  }
  lines.push(
    '',
    'This suite verifies prompt-independent behavior. A pass says nothing about answer quality, '
    + 'which only the model-dependent corpus can measure.',
    '',
  )
  return lines.join('\n')
}
