import { join } from 'node:path'

/** Build a path under a root. */
export function under(root, ...parts) {
  return join(root, ...parts)
}
