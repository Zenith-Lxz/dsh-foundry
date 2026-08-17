import { drop, write } from './store.js'
import { record } from './audit.js'

/** Save a key. */
export function save(key, value) {
  const changed = write(key, value)
  record('save', key, changed)
  return changed
}

/** Remove a key. */
export function remove(key) {
  const changed = drop(key)
  record('remove', key, changed)
  return changed
}
