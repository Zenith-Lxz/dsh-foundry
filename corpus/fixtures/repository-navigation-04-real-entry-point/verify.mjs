import { strict as assert } from 'node:assert'
import { readFileSync } from 'node:fs'

const answer = readFileSync('ANSWER.txt', 'utf8').trim().replace(/\\/g, '/')
assert.equal(answer.replace(/^\.\//, ''), 'src/cli/start.js')
console.log('ok')
