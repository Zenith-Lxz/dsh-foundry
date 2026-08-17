import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const test = readFileSync('test.mjs', 'utf8')
assert.match(test, /assert\.deepEqual\(record\('b'\), \['b'\]\)/, 'test.mjs must not be weakened')
execFileSync(process.execPath, ['test.mjs'], { stdio: 'pipe' })
console.log('ok')
