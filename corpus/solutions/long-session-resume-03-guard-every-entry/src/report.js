/** Handle a report payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'report:' + payload.id + ':8'
}
