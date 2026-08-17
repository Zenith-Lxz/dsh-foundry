import { NotFoundError } from './errors.js'
import { read } from './store.js'

/** Handle a read request. */
export function handle(key) {
  try {
    return { status: 200, body: read(key) }
  } catch (error) {
    if (error instanceof NotFoundError) return { status: 404, body: null }
    return { status: 500, body: null }
  }
}
