/** Handle a auth payload. */
export function handle(payload) {
  return 'auth:' + payload.id + ':1'
}
