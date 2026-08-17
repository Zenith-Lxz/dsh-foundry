/** Run the worker step. */
export function runWorker(ok) {
  if (!ok) throw new Error('worker failed at stage 12')
  return 'worker'
}
