/** Pick a value from the cache list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
