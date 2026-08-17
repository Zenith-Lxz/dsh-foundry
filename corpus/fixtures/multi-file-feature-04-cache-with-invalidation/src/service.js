import { read, write } from './source.js'

/** Look up a key. */
export function lookup(key) {
  return read(key)
}

/** Save a key. */
export function save(key, value) {
  write(key, value)
}
