/** Deprecated positional form. */
export function oldLog(message, level) {
  return `[${level}] ${message}`
}

/** Current object form. */
export function log({ message, level }) {
  return `[${level}] ${message}`
}
