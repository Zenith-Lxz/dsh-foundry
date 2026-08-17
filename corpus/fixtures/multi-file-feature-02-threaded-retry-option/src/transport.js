let failuresLeft = 0
let attempts = 0

/** Test seam: make the next n attempts fail. */
export function failNext(count) {
  failuresLeft = count
  attempts = 0
}

/** Attempts made since the last failNext. */
export function attemptCount() {
  return attempts
}

/** Perform one attempt. */
export function attempt(path) {
  attempts += 1
  if (failuresLeft > 0) {
    failuresLeft -= 1
    throw new Error('transport failed')
  }
  return 'ok:' + path
}
