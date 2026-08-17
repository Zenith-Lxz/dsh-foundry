import { normalize, sep } from 'node:path'

/** Whether two paths refer to the same location. */
export function samePath(left, right) {
  const strip = (value) => {
    const normalized = normalize(value)
    return normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
  }
  return strip(left) === strip(right)
}
