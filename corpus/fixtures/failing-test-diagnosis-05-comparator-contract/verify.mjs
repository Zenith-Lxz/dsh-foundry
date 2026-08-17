import { strict as assert } from 'node:assert'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { order } from './src/order.js'

const test = readFileSync('test.mjs', 'utf8')
assert.match(test, /\['a', 'b', 'c', 'd', 'e'\]/, 'test.mjs must not be weakened')
execFileSync(process.execPath, ['test.mjs'], { stdio: 'pipe' })

// A boolean comparator is order-dependent, so try many starting permutations.
const base = [1, 2, 3, 4, 5, 6, 7, 8].map((priority) => ({ name: String(priority), priority }))
for (let seed = 0; seed < 40; seed += 1) {
  const shuffled = [...base].sort(() => ((seed * 9301 + 49297) % 233280) / 233280 - 0.5)
  const sorted = order(shuffled).map((record) => record.priority)
  assert.deepEqual(sorted, [1, 2, 3, 4, 5, 6, 7, 8], 'order must not depend on input arrangement')
}
console.log('ok')
