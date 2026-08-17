import { StepError } from './errors.js'

/** Run the import step. */
export function runImport(ok) {
  if (!ok) throw new StepError('import', 'import failed at stage 6')
  return 'import'
}
