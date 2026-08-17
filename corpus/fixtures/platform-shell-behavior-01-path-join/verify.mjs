import { under } from './src/paths.js'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { strict as assert } from 'node:assert'

assert.equal(under('a', 'b', 'c'), join('a', 'b', 'c'), 'must match the platform join')
assert.equal(under('a'), 'a', 'a root alone is unchanged')
assert.equal(under('a', 'b' + sep), join('a', 'b' + sep), 'a trailing separator is normalized the same way')

const source = readFileSync('src/paths.js', 'utf8')
assert.doesNotMatch(source, /['"\\\\/]{1,2}\s*\+/, 'the separator must come from the runtime, not a literal')
console.log('ok')
