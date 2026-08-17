/** Render a value. */
export function render(value, indent) {
  return ' '.repeat(indent ?? 0) + JSON.stringify(value)
}
