import { drop, write } from './store.js'

/** Save a key. */
export function save(key, value) {
  return write(key, value)
}

/** Remove a key. */
export function remove(key) {
  return drop(key)
}
