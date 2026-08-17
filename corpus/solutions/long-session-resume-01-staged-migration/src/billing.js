import { log } from './log.js'

/** Report progress for billing. */
export function announceBilling() {
  return log({ message: 'billing step 2', level: 'info' })
}
