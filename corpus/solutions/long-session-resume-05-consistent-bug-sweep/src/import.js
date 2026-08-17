/** Pick a value from the import list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
