import { log } from './log.js'

/** Report progress for search. */
export function announceSearch() {
  return log({ message: 'search step 9', level: 'info' })
}
