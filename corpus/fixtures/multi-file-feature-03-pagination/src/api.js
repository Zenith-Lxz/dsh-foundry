import { read } from './store.js'

/** List rows. */
export function list(options = {}) {
  return { items: read() }
}
