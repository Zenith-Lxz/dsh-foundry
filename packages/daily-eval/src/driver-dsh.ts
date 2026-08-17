/**
 * The same-model lane driver.
 *
 * One configuration is one official profile. Preset selection happens through
 * profile composition, not a CLI flag, because that is where DSH actually
 * decides an agent's composition — the headless app exposes no preset option,
 * and inventing one would mean patching upstream.
 *
 * Everything the lane must hold identical is held identical here: the same
 * `dsh` binary, the same model route and reasoning effort inherited from the
 * user's own settings, the same prompt text, the same workspace revision, the
 * same timeout, and the same oracle. The profile is the only thing that varies,
 * which is what makes a difference attributable to composition.
 *
 * Each run gets its own Harness home, so one run cannot read another's session
 * log, inherit its installed profile, or resume its session by accident.
 * @module @dsh-foundry/daily-eval/driver-dsh
 */
import { spawn } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import type { ConfigurationIdentity, InvalidationCause, TaskManifest } from './schema.ts'
import { officialDecoder, readSessionLog, type RecordDecoder } from './session-log.ts'
import type { AgentDriver, DriverOutcome } from './runner.ts'

/** How to reach one configuration's DSH installation. */
export interface DshLaneConfig {
  readonly identity: ConfigurationIdentity
  /** Absolute path to the official `dsh` binary. */
  readonly dshBin: string
  /** Profile whose composition defines this configuration. */
  readonly profile: string
  /**
   * A prepared Harness home holding the profile.
   *
   * Copied per run rather than shared, so runs stay isolated without paying an
   * install for each one.
   */
  readonly templateHome: string
  /** Where per-run homes are created. */
  readonly scratchDir: string
  /** The official storage-record decoder from this installation. */
  readonly decode: RecordDecoder
}

/**
 * Patterns that mean the run tells us nothing about the agent.
 *
 * Matched against the process's own output, because these failures are reported
 * by the provider or the host rather than raised as a typed error the runner
 * could catch.
 */
const INVALIDATING_OUTPUT: readonly { readonly pattern: RegExp, readonly cause: InvalidationCause }[] = [
  { pattern: /\b(429|rate.?limit|too many requests|insufficient.?quota)\b/i, cause: 'rate-limit' },
  { pattern: /\b(401|403|unauthorized|invalid.?api.?key|authentication failed)\b/i, cause: 'authentication' },
  { pattern: /\b(econnreset|econnrefused|etimedout|enotfound|socket hang up|502|503|504)\b/i, cause: 'infrastructure' },
  { pattern: /\b(enospc|enomem|emfile|too many open files)\b/i, cause: 'host-noise' },
]

/**
 * Classify process output as an invalidation, when it is one.
 * @param output - Combined stdout and stderr.
 * @returns The invalidation, or `null` when the output shows an ordinary run.
 */
export function invalidationFromOutput(
  output: string,
): { cause: InvalidationCause, detail: string } | null {
  for (const { pattern, cause } of INVALIDATING_OUTPUT) {
    const match = pattern.exec(output)
    if (match !== null) {
      const start = Math.max(0, match.index - 80)
      return { cause, detail: output.slice(start, match.index + 120).trim() }
    }
  }
  return null
}

/**
 * Find the session log a run wrote.
 *
 * Searched by modification time under an isolated home, which holds exactly one
 * session per run. A home shared between runs would make this ambiguous, which
 * is the reason homes are not shared.
 * @param home - The run's Harness home.
 * @returns Path to the log, or `null` when the run wrote none.
 */
export function findSessionLog(home: string): string | null {
  const sessionsRoot = join(home, 'sessions')
  if (!existsSync(sessionsRoot)) return null
  let newest: { path: string, mtimeMs: number } | null = null
  for (const project of readdirSync(sessionsRoot)) {
    const projectDir = join(sessionsRoot, project)
    if (!statSync(projectDir).isDirectory()) continue
    for (const session of readdirSync(projectDir)) {
      const log = join(projectDir, session, 'session.jsonl.zstd')
      if (!existsSync(log)) continue
      const mtimeMs = statSync(log).mtimeMs
      if (newest === null || mtimeMs > newest.mtimeMs) newest = { path: log, mtimeMs }
    }
  }
  return newest?.path ?? null
}

/**
 * Build a same-model lane driver for one profile.
 * @param config - How to reach this configuration's installation.
 * @returns The driver.
 */
export function dshDriver(config: DshLaneConfig): AgentDriver {
  return {
    identity: config.identity,
    async run(task: TaskManifest, workspacePath: string, signal: AbortSignal): Promise<DriverOutcome> {
      mkdirSync(config.scratchDir, { recursive: true })
      const home = join(config.scratchDir, `home-${config.profile}-${task.id}-${Date.now()}`)
      cpSync(config.templateHome, home, { recursive: true })

      const output = await spawnCollecting(
        config.dshBin,
        ['--profile', config.profile, task.prompt],
        { cwd: workspacePath, env: { ...process.env, DSH_HOME: home }, signal },
      )

      const invalidation = invalidationFromOutput(output.combined)
      if (invalidation !== null) return { events: [], permissionDecisions: null, invalidation }

      if (output.aborted) {
        // A timeout is a property of the run, not of the harness: the agent gets
        // the task's budget and no more, and the oracle judges what it left.
        const log = findSessionLog(home)
        return {
          events: log === null ? [] : readSessionLog(log, config.decode).events,
          permissionDecisions: null,
          invalidation: null,
        }
      }

      const log = findSessionLog(home)
      if (log === null) {
        return {
          events: [],
          permissionDecisions: null,
          // No log means the harness never started a session, so nothing about
          // the agent was observed.
          invalidation: { cause: 'runner-failure', detail: `no session log under ${home}` },
        }
      }
      return { events: readSessionLog(log, config.decode).events, permissionDecisions: null, invalidation: null }
    },
  }
}

/**
 * Run a command, collecting its output and honouring an abort signal.
 * @param command - Executable.
 * @param args - Arguments.
 * @param options - Working directory, environment, and abort signal.
 * @returns The combined output and whether the run was aborted.
 */
function spawnCollecting(
  command: string,
  args: readonly string[],
  options: { cwd: string, env: NodeJS.ProcessEnv, signal: AbortSignal },
): Promise<{ combined: string, aborted: boolean }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, [...args], { cwd: options.cwd, env: options.env })
    let combined = ''
    let aborted = false
    child.stdout.on('data', (chunk: Buffer) => { combined += chunk.toString('utf8') })
    child.stderr.on('data', (chunk: Buffer) => { combined += chunk.toString('utf8') })

    const abort = (): void => {
      aborted = true
      // SIGKILL rather than SIGTERM: a harness mid-tool-call may hold the
      // workspace open, and the workspace is removed as soon as this resolves.
      child.kill('SIGKILL')
    }
    options.signal.addEventListener('abort', abort, { once: true })

    child.on('error', (error) => {
      options.signal.removeEventListener('abort', abort)
      reject(error)
    })
    child.on('close', () => {
      options.signal.removeEventListener('abort', abort)
      resolve({ combined, aborted })
    })
  })
}

export { officialDecoder }
