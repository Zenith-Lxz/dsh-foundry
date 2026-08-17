/** Handle a export payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'export:' + payload.id + ':5'
}
