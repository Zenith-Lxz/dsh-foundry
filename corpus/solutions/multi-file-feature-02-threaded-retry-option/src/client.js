import { send } from './middleware.js'

/** Make a request. */
export function request(path, options = {}) {
  return send(path, options.retries ?? 0)
}
