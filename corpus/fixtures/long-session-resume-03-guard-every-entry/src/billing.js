/** Handle a billing payload. */
export function handle(payload) {
  return 'billing:' + payload.id + ':2'
}
