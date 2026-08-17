import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

assert.equal(readFileSync('ANSWER.txt', 'utf8').trim(), 'performSync')
console.log('ok')
