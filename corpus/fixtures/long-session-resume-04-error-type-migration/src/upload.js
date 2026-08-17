/** Run the upload step. */
export function runUpload(ok) {
  if (!ok) throw new Error('upload failed at stage 10')
  return 'upload'
}
