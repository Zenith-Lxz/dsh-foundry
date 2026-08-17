/**
 * Bounded, redacted capture of supervised-child output.
 *
 * The supervisor keeps a short tail of child output so a startup failure can be
 * explained without a log file. That tail is diagnostics, never a data channel:
 * it is size-bounded so a chatty child cannot grow memory, and redacted so
 * credentials and sensitive URL query values never reach a surface or a report.
 *
 * Harness business messages are not parsed here. The only line this adapter
 * interprets is the readiness announcement, which `readiness.ts` owns.
 * @module @dsh-foundry/adapter/diagnostics
 */

/** Lines retained per stream. */
const MAX_LINES = 100

/** Maximum retained length of a single line before it is truncated. */
const MAX_LINE_LENGTH = 2000

/**
 * Patterns replaced before a line is retained or reported.
 *
 * A credential keyword redacts the whole remainder of the line rather than the
 * next token: a value like `Authorization: Bearer <jwt>` puts the secret in the
 * second token, so a single-token replacement would leave it exposed.
 */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  [/(\b(?:api[_-]?key|token|secret|password|authorization)\b\s*[:=]\s*).*/gi, '$1[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/\bsk-[A-Za-z0-9._-]{8,}/g, '[redacted-key]'],
  [/([?&][A-Za-z0-9_-]+=)[^&\s]+/g, '$1[redacted]'],
]

/**
 * Redact credentials and sensitive query values from one line.
 * @param line - Raw output line.
 * @returns The line with secret-shaped values replaced and its length bounded.
 */
export function redact(line: string): string {
  let result = line
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement)
  return result.length > MAX_LINE_LENGTH ? `${result.slice(0, MAX_LINE_LENGTH)}…[truncated]` : result
}

/**
 * A fixed-capacity tail of redacted output lines.
 *
 * Oldest lines are dropped first: a failure is explained by what the child said
 * last, and an unbounded buffer would turn a noisy child into a memory leak.
 */
export class OutputTail {
  readonly #lines: string[] = []
  readonly #capacity: number

  /**
   * @param capacity - Retained line count.
   */
  constructor(capacity: number = MAX_LINES) {
    this.#capacity = capacity
  }

  /**
   * Retain one line after redaction.
   * @param line - Raw output line.
   */
  push(line: string): void {
    this.#lines.push(redact(line))
    if (this.#lines.length > this.#capacity) this.#lines.shift()
  }

  /**
   * The retained tail, oldest first.
   * @returns A copy of the retained lines.
   */
  snapshot(): readonly string[] {
    return [...this.#lines]
  }
}

/**
 * Split a stream chunk into complete lines, returning the unterminated remainder.
 *
 * Child output arrives in arbitrary chunks, so readiness detection must not
 * depend on a line arriving whole in one chunk.
 * @param buffered - Text left over from the previous chunk.
 * @param chunk - Newly received text.
 * @returns The complete lines and the remainder to carry forward.
 */
export function splitLines(buffered: string, chunk: string): { lines: string[], rest: string } {
  const combined = buffered + chunk
  const parts = combined.split(/\r?\n/)
  const rest = parts.pop() ?? ''
  return { lines: parts, rest }
}
