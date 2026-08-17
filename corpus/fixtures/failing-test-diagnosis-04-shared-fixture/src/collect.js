const DEFAULTS = { items: [] }

/** Collect an item into an options bag. */
export function collect(item, options = DEFAULTS) {
  options.items.push(item)
  return options.items
}
