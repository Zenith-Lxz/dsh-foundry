import { StepError } from './errors.js'

/** Run the queue step. */
export function runQueue(ok) {
  if (!ok) throw new StepError('queue', 'queue failed at stage 7')
  return 'queue'
}
