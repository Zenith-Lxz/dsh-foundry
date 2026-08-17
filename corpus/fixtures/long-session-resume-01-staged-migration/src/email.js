import { oldLog } from './log.js'

/** Report progress for email. */
export function announceEmail() {
  return oldLog('email step 4', 'info')
}
