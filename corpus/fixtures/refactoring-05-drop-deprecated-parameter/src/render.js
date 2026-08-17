/** Render a value. */
export function render(value, legacy, indent) {
  if (legacy) return String(value)
  return ' '.repeat(indent ?? 0) + JSON.stringify(value)
}
