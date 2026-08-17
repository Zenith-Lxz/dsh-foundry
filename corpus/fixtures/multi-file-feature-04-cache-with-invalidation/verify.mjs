import { strict as assert } from 'node:assert'
import { lookup, save } from './src/service.js'
import { readCount, resetReads } from './src/source.js'

resetReads()
assert.equal(lookup('a'), 1)
assert.equal(lookup('a'), 1)
assert.equal(readCount(), 1, 'the second lookup must be served from the cache')

resetReads()
assert.equal(lookup('b'), 2)
assert.equal(readCount(), 1, 'a different key is a real read')

save('a', 10)
resetReads()
assert.equal(lookup('a'), 10, 'a written key returns the new value')
assert.equal(readCount(), 1, 'the written key was invalidated')

resetReads()
assert.equal(lookup('b'), 2)
assert.equal(readCount(), 0, 'writing a must not invalidate b')
console.log('ok')
