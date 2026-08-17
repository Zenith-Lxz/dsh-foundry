/** Cut text to at most max characters. */
export function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max)
}
