const data = new Map([['a', 1]])

/** Write a key, reporting whether the value changed. */
export function write(key, value) {
  const changed = data.get(key) !== value
  data.set(key, value)
  return changed
}

/** Delete a key, reporting whether it existed. */
export function drop(key) {
  return data.delete(key)
}
