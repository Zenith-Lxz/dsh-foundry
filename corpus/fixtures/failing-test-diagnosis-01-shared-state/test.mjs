import { record } from './src/counter.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(record('a'), ['a'])
assert.deepEqual(record('b'), ['b'])
console.log('ok')
