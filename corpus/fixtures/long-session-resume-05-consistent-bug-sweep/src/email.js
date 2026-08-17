/** Pick a value from the email list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
