/** Validate a username. */
export function username(value) {
  if (value.length < 3 || value.length > 20) return 'username must be 3-20 characters'
  if (!/^[a-z0-9_]+$/.test(value)) return 'username may use a-z, 0-9, and underscore'
  return null
}

/** Validate a project slug. */
export function slug(value) {
  if (value.length < 3 || value.length > 40) return 'slug must be 3-40 characters'
  if (!/^[a-z0-9_]+$/.test(value)) return 'slug may use a-z, 0-9, and underscore'
  return null
}

/** Validate a tag. */
export function tag(value) {
  if (value.length < 1 || value.length > 20) return 'tag must be 1-20 characters'
  if (!/^[a-z0-9_]+$/.test(value)) return 'tag may use a-z, 0-9, and underscore'
  return null
}
