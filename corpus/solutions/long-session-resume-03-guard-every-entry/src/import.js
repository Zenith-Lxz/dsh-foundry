/** Handle a import payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'import:' + payload.id + ':6'
}
