import { strict as assert } from 'node:assert'
import { parseRange } from './src/range.js'

assert.deepEqual(parseRange('1-5'), [1, 2, 3, 4, 5], 'the end must be included')
assert.deepEqual(parseRange('3-3'), [3], 'a single-element range')
assert.deepEqual(parseRange('0-2'), [0, 1, 2], 'a zero start')
assert.deepEqual(parseRange('7-4'), [], 'a descending range yields nothing')
console.log('ok')
