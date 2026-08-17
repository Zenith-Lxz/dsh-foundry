const data = new Map([['a', 1], ['b', 2]])
let reads = 0

/** Reads performed since the last resetReads. */
export function readCount() {
  return reads
}

/** Test seam. */
export function resetReads() {
  reads = 0
}

/** Read a key from the underlying source. */
export function read(key) {
  reads += 1
  return data.get(key)
}

/** Write a key to the underlying source. */
export function write(key, value) {
  data.set(key, value)
}
