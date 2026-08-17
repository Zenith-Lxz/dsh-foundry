import { strict as assert } from 'node:assert'
import { remove, save } from './src/service.js'
import * as audit from './src/audit.js'

const read = () => (typeof audit.entries === 'function' ? audit.entries() : audit.entries)

assert.equal(save('a', 1), false, 'the return value is unchanged')
assert.equal(save('a', 2), true)
assert.equal(remove('zz'), false, 'removing an absent key returns false')
assert.equal(remove('a'), true)

const log = read()
assert.equal(log.length, 4, 'one entry per mutation')
assert.deepEqual(
  log.map((entry) => [entry.operation, entry.key, entry.changed]),
  [['save', 'a', false], ['save', 'a', true], ['remove', 'zz', false], ['remove', 'a', true]],
  'each entry records the effect, not the intent',
)
console.log('ok')
