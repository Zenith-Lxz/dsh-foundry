import { NotFoundError } from './errors.js'

const data = new Map([['a', 1]])

/** Read a key. */
export function read(key) {
  if (!data.has(key)) throw new NotFoundError(key)
  return data.get(key)
}
