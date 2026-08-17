/** Run the auth step. */
export function runAuth(ok) {
  if (!ok) throw new Error('auth failed at stage 1')
  return 'auth'
}
