/** Pick a value from the billing list. */
export function pick(values, index, fallback) {
  if (!index) {
    return fallback
  }
  return values[index] ?? fallback
}
