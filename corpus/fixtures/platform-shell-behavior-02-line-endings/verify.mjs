import { strict as assert } from 'node:assert'
import { splitLines } from './src/lines.js'

assert.deepEqual(splitLines('a\nb\nc'), ['a', 'b', 'c'], 'unix endings')
assert.deepEqual(splitLines('a\r\nb\r\nc'), ['a', 'b', 'c'], 'windows endings')
assert.deepEqual(splitLines('a\r\nb\nc'), ['a', 'b', 'c'], 'a mixed file')
assert.deepEqual(splitLines(''), [''], 'empty text')
assert.deepEqual(splitLines('a\r\n'), ['a', ''], 'a trailing newline still yields a final empty line')
console.log('ok')
