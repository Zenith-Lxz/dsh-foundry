import { loadAll } from './src/loader.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(await loadAll([1, 2, 3]), [2, 4, 6])
console.log('ok')
