const seen = []

/** Record a name and return everything recorded for this caller. */
export function record(name) {
  seen.push(name)
  return seen
}
