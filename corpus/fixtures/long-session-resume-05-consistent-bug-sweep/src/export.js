/** Pick a value from the export list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
