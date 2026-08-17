/** Parse "k=v" pairs. */
export function parse(text) {
  if (text.length === 0) return {}
  return Object.fromEntries(text.split(',').map((pair) => {
    const separator = pair.indexOf('=')
    return [pair.slice(0, separator), pair.slice(separator + 1)]
  }))
}
