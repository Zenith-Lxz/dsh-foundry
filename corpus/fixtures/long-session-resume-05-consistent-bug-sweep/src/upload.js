/** Pick a value from the upload list. */
export function pick(values, index, fallback) {
  if (!index) {
    return fallback
  }
  return values[index] ?? fallback
}
