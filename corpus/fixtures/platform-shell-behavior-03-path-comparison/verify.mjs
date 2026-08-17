import { strict as assert } from 'node:assert'
import { samePath } from './src/compare.js'
import { join, sep } from 'node:path'

assert.equal(samePath(join('a', 'b'), join('a', 'b')), true, 'identical paths')
assert.equal(samePath('a' + sep + 'b', join('a', '.', 'b')), true, 'a redundant dot segment')
assert.equal(samePath(join('a', 'x', '..', 'b'), join('a', 'b')), true, 'a parent segment')
assert.equal(samePath('a' + sep + 'b' + sep, join('a', 'b')), true, 'a trailing separator')
assert.equal(samePath(join('a', 'b'), join('a', 'c')), false, 'genuinely different paths')
console.log('ok')
