import { strict as assert } from 'node:assert'
import { list } from './src/api.js'

assert.deepEqual(list().items, [1, 2, 3, 4, 5, 6, 7], 'no options returns everything')
assert.equal(list().total, 7, 'total is reported even without paging')

const page = list({ limit: 3 })
assert.deepEqual(page.items, [1, 2, 3])
assert.equal(page.total, 7, 'total counts every row, not the page')

const second = list({ limit: 3, offset: 3 })
assert.deepEqual(second.items, [4, 5, 6])
assert.equal(second.total, 7)

const last = list({ limit: 3, offset: 6 })
assert.deepEqual(last.items, [7], 'a short final page')

const past = list({ limit: 3, offset: 99 })
assert.deepEqual(past.items, [], 'an offset past the end yields nothing')
assert.equal(past.total, 7, 'and still reports the true total')
console.log('ok')
