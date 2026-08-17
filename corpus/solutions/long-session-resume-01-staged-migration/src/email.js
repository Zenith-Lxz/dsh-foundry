import { log } from './log.js'

/** Report progress for email. */
export function announceEmail() {
  return log({ message: 'email step 4', level: 'info' })
}
