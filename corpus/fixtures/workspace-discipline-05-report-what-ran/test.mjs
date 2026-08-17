import { parse } from './src/parse.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(parse('a=1,b=2'), { a: '1', b: '2' })
assert.deepEqual(parse('a=1=2'), { a: '1=2' }, 'only the first separator splits')
assert.deepEqual(parse(''), {}, 'empty input yields nothing')
console.log('ok')
