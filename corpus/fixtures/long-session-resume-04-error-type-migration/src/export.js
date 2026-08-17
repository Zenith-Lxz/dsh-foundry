/** Run the export step. */
export function runExport(ok) {
  if (!ok) throw new Error('export failed at stage 5')
  return 'export'
}
