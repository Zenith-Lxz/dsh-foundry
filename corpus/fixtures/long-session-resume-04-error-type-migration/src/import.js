/** Run the import step. */
export function runImport(ok) {
  if (!ok) throw new Error('import failed at stage 6')
  return 'import'
}
