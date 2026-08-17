import { format } from './lib/format.js'

/** Build a line. Passes the wrong field name. */
export function line(record) {
  return format({ name: record.label, value: record.amount })
}
