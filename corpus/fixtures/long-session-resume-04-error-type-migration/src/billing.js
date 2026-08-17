/** Run the billing step. */
export function runBilling(ok) {
  if (!ok) throw new Error('billing failed at stage 2')
  return 'billing'
}
