/** Run the email step. */
export function runEmail(ok) {
  if (!ok) throw new Error('email failed at stage 4')
  return 'email'
}
