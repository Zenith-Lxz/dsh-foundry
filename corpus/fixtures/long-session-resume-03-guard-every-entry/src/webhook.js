/** Handle a webhook payload. */
export function handle(payload) {
  return 'webhook:' + payload.id + ':11'
}
