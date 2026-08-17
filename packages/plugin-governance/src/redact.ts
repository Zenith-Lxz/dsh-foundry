/**
 * Redaction for diagnostic reports.
 *
 * A doctor report is the thing users paste into an issue, so it is the most
 * likely place for a credential to escape. Redaction runs on the way **out** of
 * every report rather than at each call site: a single forgotten call site is
 * all it takes, and the value has already left by then.
 *
 * The rule is deliberately blunt — a credential keyword redacts the rest of its
 * line. Over-redacting a diagnostic costs a round trip; under-redacting one
 * costs a rotated key.
 * @module @dsh-foundry/plugin-governance/redact
 */

/** Patterns replaced before any report text is emitted. */
const REDACTIONS: readonly (readonly [RegExp, string])[] = [
  // A credential keyword takes the remainder of the line: the secret is often
  // the second token (`Authorization: Bearer <jwt>`), so replacing one token
  // leaves it exposed.
  [/(\b(?:api[_-]?key|token|secret|password|passwd|authorization|credential)\b\s*[:=]\s*).*/gi, '$1[redacted]'],
  [/\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi, 'Bearer [redacted]'],
  [/\bsk-[A-Za-z0-9._-]{8,}/g, '[redacted-key]'],
  [/\bgh[pousr]_[A-Za-z0-9]{16,}/g, '[redacted-token]'],
  [/\b(?:eyJ[A-Za-z0-9._-]{20,})/g, '[redacted-jwt]'],
  // Query values in URLs; the parameter name survives so the shape stays
  // diagnosable.
  [/([?&][A-Za-z0-9_-]+=)[^&\s]+/g, '$1[redacted]'],
  // Cookie headers, whole.
  [/\b(?:set-)?cookie\s*:\s*.*/gi, 'cookie: [redacted]'],
]

/**
 * Redact credentials from one line of report text.
 * @param text - Raw text.
 * @returns The text with secret-shaped values replaced.
 */
export function redact(text: string): string {
  let result = text
  for (const [pattern, replacement] of REDACTIONS) result = result.replace(pattern, replacement)
  return result
}

/**
 * Redact every string in a structure, recursively.
 *
 * Reports are assembled as objects and serialized late, so redacting the final
 * string is not enough — a key name can be safe while its value is not, and a
 * nested array of environment pairs is the common case.
 * @param value - Any report fragment.
 * @returns The fragment with strings redacted.
 */
export function redactDeep<T>(value: T): T {
  if (typeof value === 'string') return redact(value) as T
  if (Array.isArray(value)) return (value as unknown[]).map((item) => redactDeep(item)) as T
  if (typeof value === 'object' && value !== null) {
    const output: Record<string, unknown> = {}
    for (const [key, item] of Object.entries(value)) {
      // A key that names a secret has its whole value dropped: the value may be
      // an object or array whose shape alone is revealing.
      output[key] = /\b(?:token|secret|password|credential|apikey|api_key|cookie|authorization)\b/i.test(key)
        ? '[redacted]'
        : redactDeep(item)
    }
    return output as T
  }
  return value
}

/**
 * Content a report must never carry at all.
 *
 * Distinct from redaction: these are not values to mask but categories to
 * exclude, because a masked version still discloses that they exist and how
 * large they are.
 */
export const EXCLUDED_FROM_REPORTS: readonly string[] = [
  'workspace file contents',
  'prompt bodies',
  'assistant or user message text',
  'session transcripts',
]
