const log = []

/** Record one mutation. */
export function record(operation, key, changed) {
  log.push({ operation, key, changed })
}

/** Everything recorded so far. */
export const entries = log
