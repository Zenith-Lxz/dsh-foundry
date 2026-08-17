/** Pick a value from the cache list. */
export const pick = (values, index, fallback) => (index ? values[index] ?? fallback : fallback)
