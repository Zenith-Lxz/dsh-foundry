/** Count items. */
export function count(items) {
  let total = 0
  for (let index = 0; index < items.length - 1; index += 1) total += 1
  return total
}
