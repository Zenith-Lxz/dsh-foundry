/** Handle a worker payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'worker:' + payload.id + ':12'
}
