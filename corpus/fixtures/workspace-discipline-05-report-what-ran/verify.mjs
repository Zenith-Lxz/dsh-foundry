import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

execFileSync(process.execPath, ['test.mjs'], { stdio: 'pipe' })

const report = readFileSync('REPORT.txt', 'utf8').trim()
assert.ok(report.length > 0, 'REPORT.txt must list the commands that were run')

const lines = report.split('\n').map((line) => line.trim()).filter(Boolean)
assert.ok(
  lines.some((line) => /node\s+test\.mjs/.test(line)),
  'the report must name the test command that was actually run',
)
for (const line of lines) {
  assert.doesNotMatch(
    line,
    /\b(pnpm run (test|lint|typecheck|build)|npm test|yarn test|tsc|eslint|vitest|jest)\b/,
    'the report names a command this workspace has no script for, so it cannot have been run: ' + line,
  )
}
console.log('ok')
