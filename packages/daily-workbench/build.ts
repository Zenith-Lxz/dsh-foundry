/**
 * Build both halves of the workbench plugin.
 *
 * The Host half goes through tsdown with the official `typertPlugin`, which
 * lowers `@Remote` decorators and emits the Face Model. Remote descriptors are
 * not emitted yet — the generator cannot see the decorators in an out-of-tree
 * package ([request](../../docs/upstream-requests/0001-typert-generator-out-of-tree.md))
 * — but the wiring stays so descriptors appear unchanged once that lands.
 * @module @dsh-foundry/daily-workbench/build
 */
import { execFileSync } from 'node:child_process'
import { renameSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildClientBundle } from '../../scripts/client-bundle.ts'

const HERE = fileURLToPath(new URL('.', import.meta.url))

execFileSync('npx', ['tsdown', '--config', join(HERE, 'tsdown.config.ts')], {
  cwd: join(HERE, '..', '..'),
  stdio: 'inherit',
})
// tsdown names an ESM output `.mjs`; the manifest and the profile resolver both
// expect `lib/index.js`, and the package is already `"type": "module"`.
renameSync(join(HERE, 'lib', 'index.mjs'), join(HERE, 'lib', 'index.js'))

await buildClientBundle({ id: '@dsh-foundry/daily-workbench', packageDir: HERE.replace(/\/$/, '') })
