/** Sort records by priority, then by name. */
export function order(records) {
  return [...records].sort((left, right) => left.priority > right.priority)
}
