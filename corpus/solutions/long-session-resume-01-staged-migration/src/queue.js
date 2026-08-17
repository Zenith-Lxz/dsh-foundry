import { log } from './log.js'

/** Report progress for queue. */
export function announceQueue() {
  return log({ message: 'queue step 7', level: 'info' })
}
