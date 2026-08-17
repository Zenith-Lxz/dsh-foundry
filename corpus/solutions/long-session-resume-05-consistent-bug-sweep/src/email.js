/** Pick a value from the email list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
