import { log } from './log.js'

/** Report progress for import. */
export function announceImport() {
  return log({ message: 'import step 6', level: 'info' })
}
