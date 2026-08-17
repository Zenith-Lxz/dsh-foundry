import { log } from './log.js'

/** Report progress for auth. */
export function announceAuth() {
  return log({ message: 'auth step 1', level: 'info' })
}
