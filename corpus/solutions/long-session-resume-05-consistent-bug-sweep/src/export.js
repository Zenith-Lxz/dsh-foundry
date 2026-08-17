/** Pick a value from the export list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
