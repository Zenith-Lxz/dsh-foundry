/**
 * Bundle the Electron main and preload entries.
 *
 * Both emit CommonJS: Electron's main process loads `.cjs` directly, and a
 * sandboxed preload cannot be an ES module. `electron` stays external because
 * the runtime provides it; everything else is inlined so the packaged
 * application resolves nothing from a source checkout or the global
 * environment.
 * @module @dsh-foundry/app/build
 */
import { build } from 'esbuild'
import { fileURLToPath } from 'node:url'

const HERE = fileURLToPath(new URL('.', import.meta.url))

const shared = {
  bundle: true,
  platform: 'node' as const,
  target: 'node22',
  format: 'cjs' as const,
  sourcemap: true,
  external: ['electron'],
  logLevel: 'info' as const,
}

// Main resolves its own location from `import.meta.url`, which a CommonJS
// output leaves empty. The shim binds it to the emitted file's own URL.
//
// It applies to main ONLY. A sandboxed preload has no `__filename`, so the same
// banner there throws at load, leaving the renderer with no bridge and the
// failure buried in the renderer console.
await build({
  ...shared,
  entryPoints: [`${HERE}src/main/index.ts`],
  outfile: `${HERE}lib/main/index.cjs`,
  banner: { js: "const __importMetaUrl = require('node:url').pathToFileURL(__filename).href;" },
  define: { 'import.meta.url': '__importMetaUrl' },
})

await build({
  ...shared,
  entryPoints: [`${HERE}src/preload/index.ts`],
  outfile: `${HERE}lib/preload/index.cjs`,
})
