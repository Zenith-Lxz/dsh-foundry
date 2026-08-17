import { read } from './store.js'

/** Handle a read request. */
export function handle(key) {
  try {
    return { status: 200, body: read(key) }
  } catch {
    return { status: 500, body: null }
  }
}
