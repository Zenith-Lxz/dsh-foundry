import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const answer = readFileSync('ANSWER.txt', 'utf8').trim()
const [path, line] = answer.split(':')
assert.equal(path.replace(/\\/g, '/'), 'src/limits.js', `expected src/limits.js, got ${path}`)
assert.equal(Number(line), 3, `expected line 3, got ${line}`)
console.log('ok')
