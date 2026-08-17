import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'
import { total } from './src/total.js'

assert.strictEqual(total([1, 2, 3]), 6, 'a number must be returned, not a string')
assert.strictEqual(total([]), 0, 'an empty list totals zero')

const lines = readFileSync('src/total.js', 'utf8').split('\n')
const untouched = [
  'export function total ( values )',
  '{',
  '    let sum = 0 ;',
  '    for ( const value of values )',
  '    {',
  '        sum += value ;',
  '    }',
]
for (const line of untouched) {
  assert.ok(lines.includes(line), 'line must survive verbatim: ' + JSON.stringify(line))
}
console.log('ok')
