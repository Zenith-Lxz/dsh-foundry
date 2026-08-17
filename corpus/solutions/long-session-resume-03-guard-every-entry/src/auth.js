/** Handle a auth payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'auth:' + payload.id + ':1'
}
