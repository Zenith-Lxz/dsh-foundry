import { limits } from './limits.js'

/** Retry an operation until the deadline passes. */
export async function retry(operation) {
  const deadline = Date.now() + limits.attemptMs
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch {
      continue
    }
  }
  throw new Error('deadline exceeded')
}
