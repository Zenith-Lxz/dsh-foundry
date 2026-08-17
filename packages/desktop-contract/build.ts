/**
 * Build the Node half of this package.
 * @module @dsh-foundry/desktop-contract/build
 */
import { fileURLToPath } from 'node:url'
import { bundleLibrary } from '../../scripts/bundle-library.ts'

await bundleLibrary(fileURLToPath(new URL('.', import.meta.url)).replace(/\/$/, ''))
