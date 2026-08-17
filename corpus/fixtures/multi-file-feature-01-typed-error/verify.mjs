import { handle } from './src/api.js'
import { read } from './src/store.js'
import * as errors from './src/errors.js'
import { strict as assert } from 'node:assert'

assert.equal(typeof errors.NotFoundError, 'function', 'NotFoundError must be exported from errors.js')
assert.ok(errors.NotFoundError.prototype instanceof Error, 'NotFoundError must extend Error')
assert.equal(typeof errors.ValidationError, 'function', 'ValidationError must remain exported')

assert.throws(() => read('missing'), errors.NotFoundError, 'store must throw NotFoundError for an absent key')
assert.equal(read('a'), 1, 'existing reads must be unchanged')

assert.deepEqual(handle('a'), { status: 200, body: 1 }, 'existing success path')
assert.equal(handle('missing').status, 404, 'absent key must become 404')
console.log('ok')
