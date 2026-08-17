/**
 * Bundle one library package's Node half.
 *
 * Shared by every package that has no bundler of its own. It exists because
 * `tsc` no longer emits JavaScript: the type face emits declarations only, so
 * the bundler is the single writer of `lib/*.js` and a build race can no longer
 * decide whether a published entry is self-contained.
 * @module scripts/bundle-library
 */
import { build } from 'esbuild'

/**
 * Bundle `src/index.ts` to `lib/index.js` for the calling package.
 * @param packageDir - Absolute package directory, without a trailing separator.
 */
export async function bundleLibrary(packageDir: string): Promise<void> {
  await build({
    entryPoints: [`${packageDir}/src/index.ts`],
    outfile: `${packageDir}/lib/index.js`,
    bundle: true,
    format: 'esm',
    platform: 'node',
    target: 'node22',
    // Third-party and official Harness packages resolve from node_modules at
    // run time. Workspace siblings are inlined instead: each companion installs
    // into a profile as its own tarball, where pnpm cannot resolve a
    // `workspace:*` range, so a declared sibling dependency fails the install.
    external: ['node:*', '@deepseek-ai/*', 'react', 'react-dom', 'zod', 'semver'],
    logLevel: 'warning',
  })
}
