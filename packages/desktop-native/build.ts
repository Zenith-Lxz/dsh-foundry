/**
 * Build both halves of the desktop directory-flow plugin: the node half the
 * Loader imports and the browser bundle the client module loader registers.
 * @module @dsh-foundry/native/build
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'
import { buildClientBundle } from '../../scripts/client-bundle.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))

await build({
  entryPoints: [`${HERE}src/index.ts`],
  outfile: `${HERE}lib/index.js`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  logLevel: 'info',
})

await buildClientBundle({ id: '@dsh-foundry/native', packageDir: HERE.replace(/\/$/, '') })
