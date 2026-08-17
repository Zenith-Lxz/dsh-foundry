/** Expand "a-b" into every number in the range. */
export function parseRange(text) {
  const [start, end] = text.split('-').map(Number)
  const out = []
  for (let value = start; value <= end; value += 1) out.push(value)
  return out
}
