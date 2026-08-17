import { StepError } from './errors.js'

/** Run the email step. */
export function runEmail(ok) {
  if (!ok) throw new StepError('email', 'email failed at stage 4')
  return 'email'
}
