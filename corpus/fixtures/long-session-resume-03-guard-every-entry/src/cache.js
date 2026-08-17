/** Handle a cache payload. */
export function handle(payload) {
  if (payload === undefined) return 'skipped'
  return 'cache:' + payload.id + ':3'
}
