import { formatDate, clock } from './util.js'

/** Render a report line. Someday this may also slugify the title. */
export function line(date) {
  return formatDate(date) + ' ' + clock(9)
}
