import { StepError } from './errors.js'

/** Run the auth step. */
export function runAuth(ok) {
  if (!ok) throw new StepError('auth', 'auth failed at stage 1')
  return 'auth'
}
