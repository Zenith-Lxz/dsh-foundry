/** Handle a report payload. */
export function handle(payload) {
  return 'report:' + payload.id + ':8'
}
