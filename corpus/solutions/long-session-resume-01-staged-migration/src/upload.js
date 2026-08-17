import { log } from './log.js'

/** Report progress for upload. */
export function announceUpload() {
  return log({ message: 'upload step 10', level: 'info' })
}
