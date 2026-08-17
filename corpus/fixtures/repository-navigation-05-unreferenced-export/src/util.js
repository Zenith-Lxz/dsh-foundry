/** Used by the report. */
export function formatDate(value) {
  return String(value)
}

/** Used only inside this module. */
export function pad(value) {
  return String(value).padStart(2, '0')
}

/** Never referenced. */
export function slugify(value) {
  return String(value).toLowerCase()
}

/** Uses pad, so pad is referenced. */
export function clock(hours) {
  return pad(hours) + ':00'
}
