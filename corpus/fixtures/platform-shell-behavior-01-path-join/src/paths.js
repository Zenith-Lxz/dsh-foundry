/** Build a path under a root. */
export function under(root, ...parts) {
  return root + '/' + parts.join('/')
}
