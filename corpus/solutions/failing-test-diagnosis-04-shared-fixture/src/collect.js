/** Collect an item into an options bag. */
export function collect(item, options = { items: [] }) {
  options.items.push(item)
  return options.items
}
