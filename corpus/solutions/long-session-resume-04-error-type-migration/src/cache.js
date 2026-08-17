import { StepError } from './errors.js'

/** Run the cache step. */
export function runCache(ok) {
  if (!ok) throw new StepError('cache', 'cache failed at stage 3')
  return 'cache'
}
