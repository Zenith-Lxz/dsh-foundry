/** Handle a search payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'search:' + payload.id + ':9'
}
