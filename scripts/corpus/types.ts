/**
 * Shared shapes for corpus task groups.
 * @module scripts/corpus/types
 */
import type { TaskManifest } from '../../packages/daily-eval/src/index.ts'

/** A task plus the fixture files it needs and a reference solution. */
export interface TaskSpec {
  readonly manifest: Omit<TaskManifest, 'corpusVersion' | 'fixture'>
  readonly files: Readonly<Record<string, string>>
  /**
   * A reference solution, written outside the fixture so a run never sees it.
   *
   * Its only purpose is to prove the oracle accepts a correct answer. Without
   * it, an oracle that always fails would look identical to a strict one.
   */
  readonly solution: Readonly<Record<string, string>>
}

/** Platforms every task without a platform-specific premise runs on. */
export const ALL_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32', 'linux']

/** Wall-clock ceiling for one run. */
export const TEN_MINUTES = 600_000

/** Decisions that stay with the user in every task. */
export const USER_AUTHORITY = [
  'model and provider selection',
  'reasoning effort',
  'billing',
  'any write outside the allowed scope',
]

/** The oracle every task uses: a Node script inside the fixture. */
export const NODE_ORACLE = { command: 'node', args: ['verify.mjs'] } as const

/**
 * Build a task manifest with the shared defaults filled in.
 * @param manifest - The fields that vary per task.
 * @returns The complete manifest.
 */
export function task(manifest: {
  readonly id: string
  readonly category: TaskManifest['category']
  readonly prompt: string
  readonly allowedScope: readonly string[]
  readonly rationale: string
  readonly platforms?: readonly NodeJS.Platform[]
  readonly userAuthority?: readonly string[]
}): TaskSpec['manifest'] {
  return {
    id: manifest.id,
    category: manifest.category,
    prompt: manifest.prompt,
    platforms: manifest.platforms ?? ALL_PLATFORMS,
    timeoutMs: TEN_MINUTES,
    allowedScope: manifest.allowedScope,
    userAuthority: manifest.userAuthority ?? USER_AUTHORITY,
    requiresNetwork: false,
    oracle: NODE_ORACLE,
    rationale: manifest.rationale,
  }
}

/** The preamble every oracle shares. */
export const ORACLE_HEADER = "import { strict as assert } from 'node:assert'\n"
