import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

assert.equal(Number(readFileSync('ANSWER.txt', 'utf8').trim()), 2)
console.log('ok')
