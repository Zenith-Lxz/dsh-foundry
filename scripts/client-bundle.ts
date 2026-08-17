/**
 * Browser-bundle build for out-of-tree DSH client plugins.
 *
 * The DSH client module loader is a lazy CommonJS table: a plugin bundle
 * REGISTERS a factory rather than executing a module body, and resolves its
 * externals through the `require` the loader injects. That handoff is the
 * loader's published runtime format, and this file reproduces it for a package
 * built outside the Harness repository:
 *
 * ```js
 * window.__ModuleLoader__.load({ id: "<package>", factory: (require) => {
 *   var module = { exports: {} }; var exports = module.exports;
 *   // bundled plugin body
 *   return module.exports; } });
 * ```
 *
 * **Externals are the module table, exactly.** A specifier the frozen table
 * cannot answer is a guaranteed runtime throw, so anything outside
 * {@link CLIENT_EXTERNALS} must be inlined. Cross-plugin value imports are
 * rejected outright: they would either duplicate a runtime instance or request
 * a specifier the table has no seat for. Plugins collaborate through Cordis
 * services and public slots, and type-only imports are erased before they
 * reach a bundler at all.
 * @module scripts/client-bundle
 */
import { existsSync } from 'node:fs'
import { build, type Plugin } from 'esbuild'

/**
 * The specifiers the shell seeds into its frozen module table.
 *
 * This mirrors the host's platform module list. A specifier absent here and
 * present at runtime is a build-time error rather than a blank screen.
 */
export const CLIENT_EXTERNALS: readonly string[] = [
  'react',
  'react/jsx-runtime',
  'react-dom',
  'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-web-react',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-attachment',
  '@deepseek-ai/dsh-client-schema-form',
  '@deepseek-ai/dsh-client-runtime/client',
]

/**
 * Reject cross-plugin value imports at build time.
 *
 * The runtime rule and the build rule are the same list: if the module table
 * cannot answer a specifier, the bundle must not ask for it.
 * @returns The esbuild plugin enforcing bundle purity.
 */
function purityGate(): Plugin {
  return {
    name: 'dsh-desktop-client-purity',
    setup(build) {
      build.onResolve({ filter: /^@deepseek-ai\// }, (args) => {
        if (CLIENT_EXTERNALS.includes(args.path)) return { external: true }
        return {
          errors: [{
            text: `client bundle purity: "${args.path}" is not a platform module the DSH client module table can answer. `
              + 'Cross-plugin value imports are forbidden — collaborate through cordis services and public slots '
              + '(type-only imports are erased and never reach this gate).',
          }],
        }
      })
    },
  }
}

/**
 * Build one client plugin's browser bundle into `lib/client.js`.
 * @param options - Package id (its npm name) and the package directory.
 */
/**
 * Resolve a package's client entry, which may be a `.ts` barrel or `.tsx`.
 * @param packageDir - Absolute package directory.
 * @returns The entry path.
 */
function clientEntry(packageDir: string): string {
  for (const extension of ['tsx', 'ts']) {
    const candidate = `${packageDir}/src/client/index.${extension}`
    if (existsSync(candidate)) return candidate
  }
  throw new Error(`no client entry at ${packageDir}/src/client/index.{ts,tsx}`)
}

export async function buildClientBundle(options: { id: string, packageDir: string }): Promise<void> {
  await build({
    // Either extension: the typert generator resolves a package's `./client`
    // export to `src/client/index.ts` exactly, so a dual-face package that
    // publishes Remotes keeps a plain barrel there and puts its JSX elsewhere.
    entryPoints: [clientEntry(options.packageDir)],
    outfile: `${options.packageDir}/lib/client.js`,
    bundle: true,
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    sourcemap: true,
    external: [...CLIENT_EXTERNALS],
    jsx: 'automatic',
    // zustand and immer read these; a CommonJS output carries no import.meta,
    // so an unsubstituted probe throws at factory execution.
    define: {
      'process.env.NODE_ENV': JSON.stringify(process.env['NODE_ENV'] ?? 'production'),
      'import.meta.env.MODE': JSON.stringify(process.env['NODE_ENV'] ?? 'production'),
    },
    loader: { '.css': 'text' },
    plugins: [purityGate()],
    banner: { js: `window.__ModuleLoader__.load({ id: ${JSON.stringify(options.id)}, factory: (require) => {\nvar module = { exports: {} }; var exports = module.exports;` },
    footer: { js: 'return module.exports; } });' },
    logLevel: 'info',
  })
}
