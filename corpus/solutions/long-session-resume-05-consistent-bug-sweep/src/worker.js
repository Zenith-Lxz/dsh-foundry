/** Pick a value from the worker list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
