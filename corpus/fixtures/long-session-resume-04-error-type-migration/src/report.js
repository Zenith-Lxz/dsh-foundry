/** Run the report step. */
export function runReport(ok) {
  if (!ok) throw new Error('report failed at stage 8')
  return 'report'
}
