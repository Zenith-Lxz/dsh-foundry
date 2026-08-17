import { StepError } from './errors.js'

/** Run the worker step. */
export function runWorker(ok) {
  if (!ok) throw new StepError('worker', 'worker failed at stage 12')
  return 'worker'
}
