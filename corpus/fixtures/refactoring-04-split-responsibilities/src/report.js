/** Formats rows and remembers what it produced. */
export class Report {
  constructor() {
    this.history = []
  }

  /** Format one row. */
  format(row) {
    const line = row.name + ': ' + row.value
    this.history.push(line)
    return line
  }

  /** Every line produced so far. */
  all() {
    return [...this.history]
  }

  /** Forget everything produced so far. */
  reset() {
    this.history = []
  }
}
