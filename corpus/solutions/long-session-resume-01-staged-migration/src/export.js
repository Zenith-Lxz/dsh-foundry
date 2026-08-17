import { log } from './log.js'

/** Report progress for export. */
export function announceExport() {
  return log({ message: 'export step 5', level: 'info' })
}
