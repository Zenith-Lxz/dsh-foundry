const data = { a: 1, b: 2 }

/** Load a key. */
export async function load(key) {
  if (typeof key !== 'string') throw new Error('key must be a string')
  if (!(key in data)) throw new Error('unknown key: ' + key)
  return data[key]
}
