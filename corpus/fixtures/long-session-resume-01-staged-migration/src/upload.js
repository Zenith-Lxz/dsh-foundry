import { oldLog } from './log.js'

/** Report progress for upload. */
export function announceUpload() {
  return oldLog('upload step 10', 'info')
}
