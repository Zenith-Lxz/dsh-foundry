/**
 * Build both halves of the desktop layout plugin.
 * @module @dsh-foundry/layout/build
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

await buildClientBundle({ id: '@dsh-foundry/layout', packageDir: HERE.replace(/\/$/, '') })
