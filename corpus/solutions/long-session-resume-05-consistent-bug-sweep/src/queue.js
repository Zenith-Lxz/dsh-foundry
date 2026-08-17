/** Pick a value from the queue list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
