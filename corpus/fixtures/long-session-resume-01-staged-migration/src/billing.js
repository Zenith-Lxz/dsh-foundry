import { oldLog } from './log.js'

/** Report progress for billing. */
export function announceBilling() {
  return oldLog('billing step 2', 'info')
}
