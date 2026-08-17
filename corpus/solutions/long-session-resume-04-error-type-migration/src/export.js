import { StepError } from './errors.js'

/** Run the export step. */
export function runExport(ok) {
  if (!ok) throw new StepError('export', 'export failed at stage 5')
  return 'export'
}
