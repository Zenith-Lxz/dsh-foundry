import { read } from './store.js'

/** List rows. */
export function list(options = {}) {
  const { page, total } = read(options)
  return { items: page, total }
}
