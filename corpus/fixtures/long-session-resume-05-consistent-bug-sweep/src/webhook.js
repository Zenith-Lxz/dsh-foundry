/** Pick a value from the webhook list. */
export const pick = (values, index, fallback) => (index ? values[index] ?? fallback : fallback)
