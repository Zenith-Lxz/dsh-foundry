import { log } from './log.js'

/** Report progress for report. */
export function announceReport() {
  return log({ message: 'report step 8', level: 'info' })
}
