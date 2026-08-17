import { log } from './log.js'

/** Report progress for cache. */
export function announceCache() {
  return log({ message: 'cache step 3', level: 'info' })
}
