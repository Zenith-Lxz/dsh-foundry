import { delimiter } from 'node:path'

/** Split a PATH value into its entries. */
export function pathEntries(value) {
  return value.split(delimiter).filter(Boolean)
}

/** Find the first directory in PATH that a predicate accepts. */
export function resolveCommand(value, exists) {
  return pathEntries(value).find(exists) ?? null
}
