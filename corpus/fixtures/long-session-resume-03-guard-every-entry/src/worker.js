/** Handle a worker payload. */
export function handle(payload) {
  return 'worker:' + payload.id + ':12'
}
