/** Merge source into a copy of target. */
export function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] ?? {}, source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
