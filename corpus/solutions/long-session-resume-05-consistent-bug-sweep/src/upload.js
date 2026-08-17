/** Pick a value from the upload list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
