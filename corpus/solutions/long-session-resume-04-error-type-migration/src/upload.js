import { StepError } from './errors.js'

/** Run the upload step. */
export function runUpload(ok) {
  if (!ok) throw new StepError('upload', 'upload failed at stage 10')
  return 'upload'
}
