/** Handle a billing payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'billing:' + payload.id + ':2'
}
