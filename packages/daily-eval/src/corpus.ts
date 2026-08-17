/**
 * Loading and validating the task corpus.
 *
 * A task is only usable when its fixture and oracle exist on disk. Loading
 * therefore validates rather than trusting the manifest: a task whose fixture
 * was renamed must fail loudly at load, because a silently skipped task shrinks
 * the denominator of every rate computed from it.
 * @module @dsh-foundry/daily-eval/corpus
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { TASK_CATEGORIES, type TaskCategory, type TaskManifest } from './schema.ts'

/** A task that could not be loaded, and why. */
export interface CorpusProblem {
  readonly taskId: string
  readonly problem: string
}

/** What loading a corpus produced. */
export interface LoadedCorpus {
  readonly version: number
  readonly tasks: readonly TaskManifest[]
  readonly problems: readonly CorpusProblem[]
}

/** Fields every task manifest file must carry. */
const REQUIRED_FIELDS: readonly (keyof TaskManifest)[] = [
  'id', 'category', 'prompt', 'fixture', 'platforms', 'timeoutMs',
  'allowedScope', 'userAuthority', 'requiresNetwork', 'oracle', 'rationale',
]

/**
 * Load every task manifest under a corpus root.
 *
 * @param root - Corpus root directory, containing `version.json` and `tasks/`.
 * @returns The loaded corpus with any problems found.
 */
export function loadCorpus(root: string): LoadedCorpus {
  const versionFile = join(root, 'version.json')
  const version = existsSync(versionFile)
    ? (JSON.parse(readFileSync(versionFile, 'utf8')) as { version: number }).version
    : 0
  const tasksDir = join(root, 'tasks')
  if (!existsSync(tasksDir)) {
    return { version, tasks: [], problems: [{ taskId: '(corpus)', problem: `no tasks directory at ${tasksDir}` }] }
  }

  const tasks: TaskManifest[] = []
  const problems: CorpusProblem[] = []
  for (const entry of readdirSync(tasksDir).sort()) {
    if (!entry.endsWith('.json')) continue
    const taskId = entry.slice(0, -'.json'.length)
    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(readFileSync(join(tasksDir, entry), 'utf8')) as Record<string, unknown>
    } catch (error) {
      problems.push({ taskId, problem: `unreadable manifest: ${String(error)}` })
      continue
    }

    const missing = REQUIRED_FIELDS.filter((field) => parsed[field] === undefined)
    if (missing.length > 0) {
      problems.push({ taskId, problem: `manifest is missing ${missing.join(', ')}` })
      continue
    }
    if (parsed['id'] !== taskId) {
      problems.push({ taskId, problem: `manifest id ${String(parsed['id'])} does not match its filename` })
      continue
    }
    if (!TASK_CATEGORIES.includes(parsed['category'] as TaskCategory)) {
      problems.push({ taskId, problem: `unknown category ${String(parsed['category'])}` })
      continue
    }
    const fixture = join(root, String(parsed['fixture']))
    if (!existsSync(fixture)) {
      problems.push({ taskId, problem: `fixture ${String(parsed['fixture'])} does not exist` })
      continue
    }
    const oracle = parsed['oracle'] as TaskManifest['oracle']
    const oracleScript = oracle.args.find((argument) => argument.endsWith('.mjs') || argument.endsWith('.js'))
    if (oracleScript !== undefined && !existsSync(join(fixture, oracleScript))) {
      problems.push({ taskId, problem: `oracle script ${oracleScript} is not in the fixture` })
      continue
    }

    tasks.push({ ...(parsed as unknown as TaskManifest), corpusVersion: version })
  }
  return { version, tasks, problems }
}

/**
 * Select the tasks that apply to a platform.
 * @param tasks - The corpus.
 * @param platform - The host platform.
 * @returns The applicable tasks.
 */
export function tasksForPlatform(
  tasks: readonly TaskManifest[],
  platform: NodeJS.Platform,
): TaskManifest[] {
  return tasks.filter((task) => task.platforms.includes(platform))
}

/**
 * Count tasks per category.
 * @param tasks - The corpus.
 * @returns A count for every category, including zeroes.
 */
export function countByCategory(tasks: readonly TaskManifest[]): Record<TaskCategory, number> {
  return Object.fromEntries(
    TASK_CATEGORIES.map((category) => [category, tasks.filter((task) => task.category === category).length]),
  ) as Record<TaskCategory, number>
}
