/** Pick a value from the webhook list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
