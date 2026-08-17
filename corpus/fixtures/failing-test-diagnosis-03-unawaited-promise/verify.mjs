import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const test = readFileSync('test.mjs', 'utf8')
assert.match(test, /deepEqual\(await loadAll\(\[1, 2, 3\]\), \[2, 4, 6\]\)/, 'test.mjs must not be weakened')
assert.doesNotMatch(test, /setTimeout|sleep|delay/, 'the test must not be made to wait')
execFileSync(process.execPath, ['test.mjs'], { stdio: 'pipe' })
console.log('ok')
