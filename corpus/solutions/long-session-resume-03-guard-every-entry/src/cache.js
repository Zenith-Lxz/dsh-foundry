/** Handle a cache payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'cache:' + payload.id + ':3'
}
