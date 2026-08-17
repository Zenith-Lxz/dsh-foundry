import { StepError } from './errors.js'

/** Run the billing step. */
export function runBilling(ok) {
  if (!ok) throw new StepError('billing', 'billing failed at stage 2')
  return 'billing'
}
