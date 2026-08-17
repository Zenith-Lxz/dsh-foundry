/** Resolve one id after a turn of the event loop. */
async function fetchOne(id) {
  await new Promise((resolve) => setTimeout(resolve, 1))
  return id * 2
}

/** Load every id, resolving each asynchronously. */
export function loadAll(ids) {
  const out = []
  ids.forEach(async (id) => {
    out.push(await fetchOne(id))
  })
  return out
}
