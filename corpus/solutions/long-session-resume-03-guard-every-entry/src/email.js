/** Handle a email payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return 'email:' + payload.id + ':4'
}
