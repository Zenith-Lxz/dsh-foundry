import { attempt } from './transport.js'

/** Apply middleware and perform the request. */
export function send(path) {
  return attempt(path)
}
