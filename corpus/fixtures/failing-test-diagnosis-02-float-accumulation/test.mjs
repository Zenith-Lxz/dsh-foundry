import { total } from './src/total.js'
import { strict as assert } from 'node:assert'

assert.equal(total([0.1, 0.2]), 0.3)
assert.equal(total([19.99, 0.01]), 20)
console.log('ok')
