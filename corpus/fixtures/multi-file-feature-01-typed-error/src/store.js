const data = new Map([['a', 1]])

/** Read a key. */
export function read(key) {
  return data.get(key)
}
