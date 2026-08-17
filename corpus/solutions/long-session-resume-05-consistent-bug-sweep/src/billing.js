/** Pick a value from the billing list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
