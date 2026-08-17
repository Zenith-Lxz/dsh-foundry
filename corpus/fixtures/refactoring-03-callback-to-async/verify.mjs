import { strict as assert } from 'node:assert'
import { load } from './src/load.js'

const result = load('a')
assert.ok(result instanceof Promise, 'load must return a promise')
assert.equal(await result, 1)
assert.equal(await load('b'), 2)

await assert.rejects(load('zz'), { message: 'unknown key: zz' }, 'an unknown key keeps its message')
await assert.rejects(load(42), { message: 'key must be a string' }, 'a bad key type keeps its own message')
assert.equal(load.length, 1, 'the callback parameter must be gone')
console.log('ok')
