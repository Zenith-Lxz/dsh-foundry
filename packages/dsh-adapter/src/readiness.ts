/**
 * Versioned readiness parsing for the official DSH runtime.
 *
 * The tested release announces its bound address on stdout as a single line:
 *
 * ```text
 * dsh web: http://127.0.0.1:56064
 * ```
 *
 * Parsing that human-readable line is a compatibility risk, so it is confined
 * here and nowhere else in the companion application. When an official
 * machine-readable ready receipt becomes available, a new adapter version
 * consumes it without changing Electron or the plugins.
 * @module @dsh-foundry/adapter/readiness
 */

/** Hosts accepted as loopback. Anything else is a non-loopback receipt and is rejected. */
const LOOPBACK_HOSTS = new Set(['127.0.0.1', 'localhost', '[::1]', '::1'])

/** The ready line emitted by the supported release family. */
const READY_LINE = /^dsh\s+\S+:\s+(\S+)\s*$/

/** Why a candidate readiness line was refused. */
export type ReadinessRejection =
  | 'not-a-ready-line'
  | 'malformed-url'
  | 'unsupported-scheme'
  | 'non-loopback-host'
  | 'invalid-port'
  | 'duplicate-receipt'

/** The outcome of examining one output line. */
export type ReadinessOutcome =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'ready', readonly origin: string, readonly port: number }
  | { readonly kind: 'rejected', readonly reason: ReadinessRejection, readonly line: string }

/**
 * Single-receipt readiness parser for one supervised child generation.
 *
 * Stateful by design: exactly one origin is ever accepted per instance, so a
 * duplicate or late second receipt is reported as a rejection instead of
 * silently repointing the window at a different origin.
 */
export class ReadinessParser {
  /** Adapter version recorded in diagnostics and in the compatibility manifest. */
  static readonly version = 1

  #accepted: string | undefined

  /** The accepted origin, or `undefined` before readiness. */
  get origin(): string | undefined {
    return this.#accepted
  }

  /**
   * Examine one line of child stdout.
   *
   * A line that is not the ready announcement is ignored, so ordinary logging
   * never fails startup. A line that announces readiness but fails validation
   * is rejected, and the caller terminates the child.
   * @param line - One line of child stdout, without its newline.
   * @returns Whether the line was ignored, produced readiness, or was rejected.
   */
  observe(line: string): ReadinessOutcome {
    const match = READY_LINE.exec(line.trim())
    if (match === null) return { kind: 'ignored' }
    const raw = match[1]
    if (raw === undefined) return { kind: 'ignored' }

    let url: URL
    try {
      url = new URL(raw)
    } catch {
      // The announcement matched but its address is unusable; there is no other
      // reader of this line, so classification ends here.
      return { kind: 'rejected', reason: 'malformed-url', line }
    }
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
      return { kind: 'rejected', reason: 'unsupported-scheme', line }
    }
    if (!LOOPBACK_HOSTS.has(url.hostname)) {
      return { kind: 'rejected', reason: 'non-loopback-host', line }
    }
    const port = Number(url.port)
    if (!Number.isInteger(port) || port <= 0 || port > 65535) {
      return { kind: 'rejected', reason: 'invalid-port', line }
    }
    if (this.#accepted !== undefined) {
      return { kind: 'rejected', reason: 'duplicate-receipt', line }
    }
    this.#accepted = url.origin
    return { kind: 'ready', origin: url.origin, port }
  }
}
