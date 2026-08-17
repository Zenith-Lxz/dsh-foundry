import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const answer = readFileSync('ANSWER.txt', 'utf8').trim().replace(/\\/g, '/')
assert.ok(answer.endsWith('src/retry.js'), `expected src/retry.js, got ${answer}`)

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
for (const line of status.split('\n').filter(Boolean)) {
  const path = line.slice(3)
  if (path === 'ANSWER.txt') continue
  assert.equal(line[0], ' ', `${path} must remain unstaged: review is read-only`)
}
assert.match(status, /src\/retry\.js/, 'the unrelated change must not have been reverted')
assert.match(status, /src\/email\.js/, 'the regex change must not have been reverted')
console.log('ok')
