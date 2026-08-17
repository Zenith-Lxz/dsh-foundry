/**
 * Host-half build for the workbench.
 *
 * tsdown rather than esbuild because the official `typertPlugin` is a tsdown
 * plugin: it lowers the `@Remote` decorators and emits `typert.host.js` and
 * `typert.remote-client.js` from the analyzed Face Model. Hand-writing those
 * artifacts would make the wire schemas a second source of truth that drifts
 * from the method signatures they describe.
 * @module @dsh-foundry/daily-workbench/tsdown.config
 */
import { typertPlugin } from '@deepseek-ai/dsh-typert-generator/tsdown'
import { defineConfig } from 'tsdown'

export default defineConfig({
  entry: ['src/index.ts'],
  outDir: 'lib',
  format: 'esm',
  platform: 'node',
  target: 'node22',
  dts: false,
  // Workspace siblings are inlined for the same reason as every other
  // companion: each installs into a profile as its own tarball, where a
  // `workspace:*` range cannot resolve.
  external: [/^node:/, /^@deepseek-ai\//, 'react', 'react-dom', 'zod'],
  plugins: [typertPlugin({ mode: 'workspace' })],
})
