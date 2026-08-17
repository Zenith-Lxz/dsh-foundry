import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

const answer = readFileSync('ANSWER.txt', 'utf8').trim().replace(/\\/g, '/')
assert.ok(answer.endsWith('src/removed.js'), 'expected src/removed.js, got ' + answer)

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
for (const line of status.split('\n').filter(Boolean)) {
  const path = line.slice(3)
  if (path === 'ANSWER.txt') continue
  // '??' is untracked, which the fixture setup itself produces; anything else
  // with a non-blank first column has been staged.
  if (line.startsWith('??')) continue
  assert.equal(line[0], ' ', path + ' must remain unstaged: review is read-only')
}
const log = execFileSync('git', ['rev-list', '--count', 'HEAD'], { encoding: 'utf8' }).trim()
assert.equal(log, '1', 'no commit may be created during a review')

console.log('ok')
