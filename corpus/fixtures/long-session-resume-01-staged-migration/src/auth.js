import { oldLog } from './log.js'

/** Report progress for auth. */
export function announceAuth() {
  return oldLog('auth step 1', 'info')
}
