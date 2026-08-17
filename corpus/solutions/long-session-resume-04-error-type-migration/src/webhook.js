import { StepError } from './errors.js'

/** Run the webhook step. */
export function runWebhook(ok) {
  if (!ok) throw new StepError('webhook', 'webhook failed at stage 11')
  return 'webhook'
}
