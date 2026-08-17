/** Handle a queue payload. */
export function handle(payload) {
  return 'queue:' + payload.id + ':7'
}
