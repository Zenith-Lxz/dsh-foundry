/** Pick a value from the worker list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
