import { attempt } from './transport.js'

/** Apply middleware and perform the request, retrying as configured. */
export function send(path, retries = 0) {
  let lastError
  for (let tries = 0; tries <= retries; tries += 1) {
    try {
      return attempt(path)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
