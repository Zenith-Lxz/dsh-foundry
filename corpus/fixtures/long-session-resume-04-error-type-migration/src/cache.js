/** Run the cache step. */
export function runCache(ok) {
  if (!ok) throw new Error('cache failed at stage 3')
  return 'cache'
}
