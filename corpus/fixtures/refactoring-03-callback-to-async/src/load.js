const data = { a: 1, b: 2 }

/** Load a key, calling back with (error, value). */
export function load(key, callback) {
  if (typeof key !== 'string') {
    callback(new Error('key must be a string'))
    return
  }
  if (!(key in data)) {
    callback(new Error('unknown key: ' + key))
    return
  }
  callback(null, data[key])
}
