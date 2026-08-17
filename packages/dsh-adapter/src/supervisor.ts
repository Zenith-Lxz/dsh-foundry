/**
 * Supervision of one official DSH child process.
 *
 * The supervisor owns child identity, readiness, exit classification, restart,
 * and shutdown. It never inspects Harness business traffic: the only child
 * output it interprets is the readiness announcement, and everything else is
 * bounded, redacted diagnostics.
 *
 * **Generations.** Every start increments a generation counter. The generation
 * is the authority token the Electron layer checks before honouring a renderer
 * request, so a restart invalidates the previous renderer's authority before a
 * replacement origin can load. Two hosts never run at once: a restart fully
 * terminates and awaits the old tree before starting a new one.
 *
 * **Shutdown is verified, not assumed.** Graceful stop is followed by a bounded
 * wait, then escalation, then a descendant enumeration. The parent's exit alone
 * is never treated as quiescence, because a tool or terminal the Harness owns
 * can outlive it.
 * @module @dsh-foundry/adapter/supervisor
 */
import { spawn, type ChildProcess } from 'node:child_process'
import { EventEmitter } from 'node:events'
import { OutputTail, splitLines } from './diagnostics.ts'
import { ReadinessParser, type ReadinessRejection } from './readiness.ts'
import { processFace, type ProcessFace } from './platform.ts'
import type { ResolvedRuntime } from './resolve.ts'

/** How long to wait for a graceful stop before escalating. */
export const GRACEFUL_STOP_TIMEOUT_MS = 8000

/** How long to wait after escalation before reporting surviving descendants. */
export const ESCALATION_TIMEOUT_MS = 5000

/** How long to wait for readiness before treating startup as failed. */
export const READINESS_TIMEOUT_MS = 60_000

/** Observable supervisor states. */
export type HostState =
  | { readonly kind: 'idle' }
  | { readonly kind: 'starting', readonly generation: number }
  | { readonly kind: 'ready', readonly generation: number, readonly origin: string, readonly pid: number }
  | { readonly kind: 'stopping', readonly generation: number }
  | { readonly kind: 'exited', readonly generation: number, readonly classification: ExitClassification }

/** Why a child stopped running. */
export type ExitClassification =
  | { readonly kind: 'clean' }
  | { readonly kind: 'requested', readonly escalated: boolean }
  | { readonly kind: 'startup-failed', readonly reason: string, readonly tail: readonly string[] }
  | { readonly kind: 'readiness-rejected', readonly reason: ReadinessRejection, readonly tail: readonly string[] }
  | { readonly kind: 'crashed', readonly code: number | null, readonly signal: string | null, readonly tail: readonly string[] }

/** Outcome of a completed shutdown, including whether escalation was needed. */
export interface ShutdownReport {
  readonly escalated: boolean
  /** Descendants still alive after escalation; empty means verified quiescence. */
  readonly survivingDescendants: readonly number[]
  readonly durationMs: number
}

/** Events the Electron layer observes. */
export interface SupervisorEvents {
  state: [HostState]
  ready: [{ generation: number, origin: string, pid: number }]
  exited: [{ generation: number, classification: ExitClassification }]
  diagnostic: [string]
}

/** Configuration for one supervised host. */
export interface SupervisorOptions {
  readonly runtime: ResolvedRuntime
  /** Profile name passed to the official CLI. */
  readonly profile: string
  /** Working directory the Harness adopts as its default workspace root. */
  readonly cwd: string
  /** Harness home; when absent the child inherits the user's default home. */
  readonly dshHome?: string
  /** Platform face; injected in tests, resolved from the current platform otherwise. */
  readonly face?: ProcessFace
}

/**
 * Supervises exactly one official DSH child process at a time.
 */
export class DshSupervisor extends EventEmitter<SupervisorEvents> {
  readonly #options: SupervisorOptions
  readonly #face: ProcessFace
  #generation = 0
  #child: ChildProcess | undefined
  #state: HostState = { kind: 'idle' }
  #exitPromise: Promise<ExitClassification> | undefined
  #stopping: Promise<ShutdownReport> | undefined

  /**
   * @param options - Resolved runtime, profile, workspace, and platform face.
   */
  constructor(options: SupervisorOptions) {
    super()
    this.#options = options
    this.#face = options.face ?? processFace()
  }

  /** Current observable state. */
  get state(): HostState {
    return this.#state
  }

  /** The generation currently authorized to serve renderer requests. */
  get generation(): number {
    return this.#generation
  }

  /** The accepted origin while ready, `undefined` otherwise. */
  get origin(): string | undefined {
    return this.#state.kind === 'ready' ? this.#state.origin : undefined
  }

  /**
   * Start a new host generation and resolve when it reports a valid ready origin.
   *
   * Rejects — after terminating the child — when readiness times out, the child
   * exits first, or the announced address fails loopback validation.
   * @returns The accepted origin and the generation that owns it.
   * @throws Error when startup does not reach a valid readiness receipt.
   */
  async start(): Promise<{ generation: number, origin: string }> {
    if (this.#child !== undefined) throw new Error('a DSH host is already running for this supervisor')
    const generation = ++this.#generation
    this.#setState({ kind: 'starting', generation })

    const tail = new OutputTail()
    const parser = new ReadinessParser()
    const child = spawn(
      this.#options.runtime.nodePath,
      [this.#options.runtime.dshEntry, '--profile', this.#options.profile, '--host', '127.0.0.1', '--port', '0'],
      {
        cwd: this.#options.cwd,
        detached: this.#face.detached,
        windowsHide: true,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: this.#childEnvironment(),
      },
    )
    this.#child = child

    const exited = new Promise<ExitClassification>((resolve) => {
      child.once('exit', (code, signal) => {
        const classification: ExitClassification = this.#state.kind === 'stopping'
          ? { kind: 'requested', escalated: false }
          : code === 0
            ? { kind: 'clean' }
            : { kind: 'crashed', code, signal, tail: tail.snapshot() }
        resolve(classification)
      })
    })
    this.#exitPromise = exited

    const ready = new Promise<string>((resolve, reject) => {
      let stdoutRest = ''
      let stderrRest = ''
      let settled = false
      const settle = (action: () => void): void => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        action()
      }

      const timer = setTimeout(() => {
        settle(() => reject(new Error(
          `the DSH host did not report readiness within ${READINESS_TIMEOUT_MS}ms\n${tail.snapshot().join('\n')}`,
        )))
      }, READINESS_TIMEOUT_MS)

      child.stdout?.setEncoding('utf8')
      child.stdout?.on('data', (chunk: string) => {
        const { lines, rest } = splitLines(stdoutRest, chunk)
        stdoutRest = rest
        for (const line of lines) {
          tail.push(line)
          const outcome = parser.observe(line)
          if (outcome.kind === 'ready') {
            settle(() => resolve(outcome.origin))
          } else if (outcome.kind === 'rejected') {
            const reason = outcome.reason
            settle(() => reject(Object.assign(
              new Error(`the DSH host reported an unusable ready address (${reason})`),
              { readinessRejection: reason, tail: tail.snapshot() },
            )))
          }
        }
      })
      child.stderr?.setEncoding('utf8')
      child.stderr?.on('data', (chunk: string) => {
        const { lines, rest } = splitLines(stderrRest, chunk)
        stderrRest = rest
        for (const line of lines) {
          tail.push(line)
          this.emit('diagnostic', line)
        }
      })
      child.once('error', (error) => {
        settle(() => reject(error))
      })
      exited.then((classification) => {
        settle(() => reject(Object.assign(
          new Error('the DSH host exited before reporting readiness'),
          { classification, tail: tail.snapshot() },
        )))
      }, () => {
        // The exit promise never rejects; it resolves with a classification.
      })
    })

    let origin: string
    try {
      origin = await ready
    } catch (error) {
      await this.#terminate()
      this.#setState({
        kind: 'exited',
        generation,
        classification: readinessFailureClassification(error, tail.snapshot()),
      })
      throw error
    }

    const pid = child.pid
    if (pid === undefined) throw new Error('the DSH host reported readiness without a process id')
    this.#setState({ kind: 'ready', generation, origin, pid })
    this.emit('ready', { generation, origin, pid })
    void exited.then((classification) => {
      if (this.#state.kind === 'exited') return
      this.#child = undefined
      this.#setState({ kind: 'exited', generation, classification })
      this.emit('exited', { generation, classification })
    })
    return { generation, origin }
  }

  /**
   * Stop the host and verify that its owned tree is gone.
   *
   * Repeated calls join the first sequence rather than starting a second one,
   * so a quit racing an in-flight quit cannot interleave two escalations.
   * @returns Whether escalation was required and which descendants, if any, survived.
   */
  async stop(): Promise<ShutdownReport> {
    if (this.#stopping !== undefined) return this.#stopping
    this.#stopping = this.#runStop()
    try {
      return await this.#stopping
    } finally {
      this.#stopping = undefined
    }
  }

  /**
   * Terminate the current generation and start a new one.
   *
   * The old tree is fully awaited before the new child spawns, so two hosts
   * never overlap and the previous origin is dead before a replacement loads.
   * @returns The new generation and its accepted origin.
   */
  async restart(): Promise<{ generation: number, origin: string }> {
    await this.stop()
    return this.start()
  }

  /**
   * Enumerate descendants of the running child.
   * @returns Live descendant process ids; empty when no child is running.
   */
  async listDescendants(): Promise<number[]> {
    const pid = this.#child?.pid
    if (pid === undefined) return []
    return this.#face.listDescendants(pid)
  }

  /**
   * Run one shutdown sequence: graceful request, bounded wait, escalation, verification.
   * @returns The shutdown report.
   */
  async #runStop(): Promise<ShutdownReport> {
    const started = Date.now()
    const child = this.#child
    const pid = child?.pid
    if (child === undefined || pid === undefined) {
      return { escalated: false, survivingDescendants: [], durationMs: Date.now() - started }
    }
    const generation = this.#generation
    this.#setState({ kind: 'stopping', generation })

    await this.#face.requestGracefulStop(pid)
    const exitedInTime = await raceTimeout(this.#exitPromise ?? Promise.resolve(undefined), GRACEFUL_STOP_TIMEOUT_MS)

    let escalated = false
    if (!exitedInTime) {
      escalated = true
      await this.#face.forceStopTree(pid)
      await raceTimeout(this.#exitPromise ?? Promise.resolve(undefined), ESCALATION_TIMEOUT_MS)
    }

    const survivingDescendants = await this.#face.listDescendants(pid)
    if (survivingDescendants.length > 0 && !escalated) {
      // The parent exited politely but left owned work behind; the contract is
      // tree quiescence, so escalate against the survivors before reporting.
      escalated = true
      await this.#face.forceStopTree(pid)
    }
    const remaining = escalated ? await this.#face.listDescendants(pid) : survivingDescendants

    this.#child = undefined
    this.#setState({ kind: 'exited', generation, classification: { kind: 'requested', escalated } })
    return { escalated, survivingDescendants: remaining, durationMs: Date.now() - started }
  }

  /** Force the current child down without reporting, used on a failed start. */
  async #terminate(): Promise<void> {
    const pid = this.#child?.pid
    if (pid === undefined) {
      this.#child = undefined
      return
    }
    await this.#face.forceStopTree(pid)
    this.#child = undefined
  }

  /**
   * Build the child's minimal environment.
   *
   * The child inherits the user's environment because the Harness legitimately
   * needs credentials, proxy settings, and a PATH for the tools it runs. The
   * adapter adds only what selects the desktop composition.
   * @returns The environment passed to the child.
   */
  #childEnvironment(): NodeJS.ProcessEnv {
    const environment: NodeJS.ProcessEnv = { ...process.env }
    if (this.#options.dshHome !== undefined) environment['DSH_HOME'] = this.#options.dshHome
    // Electron sets these for its own helpers; leaking them into a plain Node
    // child changes how that child bootstraps.
    delete environment['ELECTRON_RUN_AS_NODE']
    delete environment['ELECTRON_NO_ATTACH_CONSOLE']
    return environment
  }

  /**
   * Record and broadcast a state transition.
   * @param state - The new state.
   */
  #setState(state: HostState): void {
    this.#state = state
    this.emit('state', state)
  }
}

/**
 * Classify a startup failure for diagnostics.
 * @param error - The rejection produced during startup.
 * @param tail - Redacted output tail at the time of failure.
 * @returns The exit classification to record.
 */
function readinessFailureClassification(error: unknown, tail: readonly string[]): ExitClassification {
  const rejection = (error as { readinessRejection?: ReadinessRejection }).readinessRejection
  if (rejection !== undefined) return { kind: 'readiness-rejected', reason: rejection, tail }
  return { kind: 'startup-failed', reason: error instanceof Error ? error.message : String(error), tail }
}

/**
 * Await a promise with a bound.
 * @param promise - Work to await.
 * @param timeoutMs - Maximum wait.
 * @returns True when the promise settled first, false on timeout.
 */
async function raceTimeout(promise: Promise<unknown>, timeoutMs: number): Promise<boolean> {
  let timer: NodeJS.Timeout | undefined
  const timeout = new Promise<false>((resolve) => {
    timer = setTimeout(() => resolve(false), timeoutMs)
  })
  try {
    return await Promise.race([promise.then(() => true), timeout])
  } finally {
    if (timer !== undefined) clearTimeout(timer)
  }
}
