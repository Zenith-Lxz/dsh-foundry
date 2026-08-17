/** Handle a upload payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'upload:' + payload.id + ':10'
}
