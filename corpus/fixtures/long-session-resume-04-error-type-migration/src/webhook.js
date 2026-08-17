/** Run the webhook step. */
export function runWebhook(ok) {
  if (!ok) throw new Error('webhook failed at stage 11')
  return 'webhook'
}
