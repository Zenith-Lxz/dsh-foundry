import { collect } from './src/collect.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(collect('a'), ['a'])
assert.deepEqual(collect('b'), ['b'])
console.log('ok')
