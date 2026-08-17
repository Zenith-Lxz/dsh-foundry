/** Handle a webhook payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'webhook:' + payload.id + ':11'
}
