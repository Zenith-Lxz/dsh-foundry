const rows = [1, 2, 3, 4, 5, 6, 7]

/** Read rows, optionally a page of them. */
export function read({ limit, offset = 0 } = {}) {
  const all = [...rows]
  const page = limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit)
  return { page, total: all.length }
}
