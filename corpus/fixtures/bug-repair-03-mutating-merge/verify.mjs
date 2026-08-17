import { strict as assert } from 'node:assert'
import { deepMerge } from './src/merge.js'

const target = { a: 1, nested: { x: 1 } }
const source = { b: 2, nested: { y: 2 } }
const merged = deepMerge(target, source)

assert.deepEqual(merged, { a: 1, b: 2, nested: { x: 1, y: 2 } }, 'the merged result')
assert.deepEqual(target, { a: 1, nested: { x: 1 } }, 'the first input must be unchanged')
assert.deepEqual(source, { b: 2, nested: { y: 2 } }, 'the second input must be unchanged')
merged.nested.z = 3
assert.equal(target.nested.z, undefined, 'the result must not alias the input')
console.log('ok')
