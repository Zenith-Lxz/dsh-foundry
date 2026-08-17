/** Handle a queue payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'queue:' + payload.id + ':7'
}
