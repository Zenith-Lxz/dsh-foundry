/** Raised when a step fails. */
export class StepError extends Error {
  constructor(step, message) {
    super(message)
    this.step = step
  }
}
