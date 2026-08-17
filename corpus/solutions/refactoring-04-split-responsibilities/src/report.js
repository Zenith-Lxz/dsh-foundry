/** Remembers produced lines. */
export class History {
  constructor() {
    this.lines = []
  }

  /** Record one line. */
  add(line) {
    this.lines.push(line)
  }

  /** Every line recorded so far. */
  all() {
    return [...this.lines]
  }

  /** Forget everything recorded so far. */
  clear() {
    this.lines = []
  }
}

/** Formats rows. */
export class Report {
  constructor() {
    this.history = new History()
  }

  /** Format one row. */
  format(row) {
    const line = row.name + ': ' + row.value
    this.history.add(line)
    return line
  }

  /** Every line produced so far. */
  all() {
    return this.history.all()
  }

  /** Forget everything produced so far. */
  reset() {
    this.history.clear()
  }
}
