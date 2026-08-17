/** Merge source into a copy of target. */
export function deepMerge(target, source) {
  const out = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] ?? {}, source[key])
    } else {
      out[key] = source[key]
    }
  }
  return out
}
