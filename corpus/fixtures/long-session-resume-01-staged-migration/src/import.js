import { oldLog } from './log.js'

/** Report progress for import. */
export function announceImport() {
  return oldLog('import step 6', 'info')
}
