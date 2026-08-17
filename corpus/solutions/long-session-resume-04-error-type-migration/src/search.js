import { StepError } from './errors.js'

/** Run the search step. */
export function runSearch(ok) {
  if (!ok) throw new StepError('search', 'search failed at stage 9')
  return 'search'
}
