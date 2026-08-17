import { oldLog } from './log.js'

/** Report progress for export. */
export function announceExport() {
  return oldLog('export step 5', 'info')
}
