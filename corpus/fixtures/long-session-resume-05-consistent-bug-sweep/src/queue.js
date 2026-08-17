/** Pick a value from the queue list. */
export const pick = (values, index, fallback) => (index ? values[index] ?? fallback : fallback)
