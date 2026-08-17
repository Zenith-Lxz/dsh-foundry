import { rank } from './src/rank.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(rank([3, 1, 2]), [3, 2, 1], 'single digits')
assert.deepEqual(rank([10, 9, 100]), [100, 10, 9], 'mixed digit lengths')
assert.deepEqual(rank([2, 10]), [10, 2], 'two against ten')
assert.deepEqual(rank([]), [], 'empty input')
assert.deepEqual(rank([-1, -10, 5]), [5, -1, -10], 'negatives')
const original = [1, 2, 3]
rank(original)
assert.deepEqual(original, [1, 2, 3], 'input must not be mutated')
console.log('ok')
