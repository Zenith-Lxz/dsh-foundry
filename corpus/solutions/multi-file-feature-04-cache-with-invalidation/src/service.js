import { read, write } from './source.js'
import { get, invalidate, set } from './cache.js'

/** Look up a key. */
export function lookup(key) {
  const cached = get(key)
  if (cached !== undefined) return cached
  const value = read(key)
  set(key, value)
  return value
}

/** Save a key. */
export function save(key, value) {
  write(key, value)
  invalidate(key)
}
