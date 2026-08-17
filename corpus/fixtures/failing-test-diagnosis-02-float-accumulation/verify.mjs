import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const test = readFileSync('test.mjs', 'utf8')
assert.match(test, /assert\.equal\(total\(\[0\.1, 0\.2\]\), 0\.3\)/, 'test.mjs must not be weakened')
execFileSync(process.execPath, ['test.mjs'], { stdio: 'pipe' })
console.log('ok')
