/**
 * Bundle the daily agent plugin for distribution.
 *
 * `@dsh-foundry/daily-contract` is inlined: it is a vocabulary package of types
 * and constants with no runtime identity to share, so carrying it as a separate
 * published dependency would add a distribution edge that buys nothing.
 *
 * `@deepseek-ai/*` stays external. Those packages are provided by the official
 * installation the profile already resolves, and inlining a copy would both
 * duplicate runtime identity and violate the zero-upstream-copy rule.
 * @module @dsh-foundry/daily-agent/build
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))

await build({
  entryPoints: [`${HERE}src/index.ts`],
  outfile: `${HERE}lib/index.js`,
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: 'node22',
  external: ['@deepseek-ai/*'],
  logLevel: 'info',
})
