import { oldLog } from './log.js'

/** Report progress for cache. */
export function announceCache() {
  return oldLog('cache step 3', 'info')
}
