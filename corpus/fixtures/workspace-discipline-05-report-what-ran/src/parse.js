/** Parse "k=v" pairs. */
export function parse(text) {
  return Object.fromEntries(text.split(',').map((pair) => pair.split('=')))
}
