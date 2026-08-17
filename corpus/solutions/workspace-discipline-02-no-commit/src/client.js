import { MAX_RETRIES } from './config.js'

/** Attempts allowed. */
export function attempts() {
  return MAX_RETRIES
}
