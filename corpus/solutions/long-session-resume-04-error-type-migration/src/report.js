import { StepError } from './errors.js'

/** Run the report step. */
export function runReport(ok) {
  if (!ok) throw new StepError('report', 'report failed at stage 8')
  return 'report'
}
