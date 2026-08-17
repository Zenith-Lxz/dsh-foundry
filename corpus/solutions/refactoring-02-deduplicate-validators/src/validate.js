/** Check length and charset, producing the field's own messages. */
export function checkField(label, value, min, max) {
  if (value.length < min || value.length > max) return label + ' must be ' + min + '-' + max + ' characters'
  if (!/^[a-z0-9_]+$/.test(value)) return label + ' may use a-z, 0-9, and underscore'
  return null
}

/** Validate a username. */
export function username(value) {
  return checkField('username', value, 3, 20)
}

/** Validate a project slug. */
export function slug(value) {
  return checkField('slug', value, 3, 40)
}

/** Validate a tag. */
export function tag(value) {
  return checkField('tag', value, 1, 20)
}
