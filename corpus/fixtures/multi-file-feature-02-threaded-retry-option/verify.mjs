import { strict as assert } from 'node:assert'
import { request } from './src/client.js'
import { attemptCount, failNext } from './src/transport.js'

failNext(0)
assert.equal(request('/a'), 'ok:/a', 'the existing path is unchanged')
assert.equal(attemptCount(), 1, 'no retries by default')

failNext(1)
assert.throws(() => request('/b'), /transport failed/, 'without retries a failure still throws')

failNext(2)
assert.equal(request('/c', { retries: 2 }), 'ok:/c', 'two retries survive two failures')
assert.equal(attemptCount(), 3, 'one initial attempt plus two retries')

failNext(3)
assert.throws(() => request('/d', { retries: 1 }), /transport failed/, 'retries are bounded by the option')
console.log('ok')
