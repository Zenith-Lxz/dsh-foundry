/** Pick a value from the search list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
