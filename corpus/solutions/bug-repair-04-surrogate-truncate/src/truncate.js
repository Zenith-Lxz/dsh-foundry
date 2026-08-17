/** Cut text to at most max characters. */
export function truncate(text, max) {
  const characters = [...text]
  return characters.length <= max ? text : characters.slice(0, max).join('')
}
