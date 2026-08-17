/** Pick a value from the auth list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
