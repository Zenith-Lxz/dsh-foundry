/** Pick a value from the auth list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
