const entries = new Map()

/** Read a cached value, or undefined when absent. */
export function get(key) {
  return entries.get(key)
}

/** Store a value. */
export function set(key, value) {
  entries.set(key, value)
}

/** Drop one key. */
export function invalidate(key) {
  entries.delete(key)
}
