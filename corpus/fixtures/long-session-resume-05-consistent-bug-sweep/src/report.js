/** Pick a value from the report list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
