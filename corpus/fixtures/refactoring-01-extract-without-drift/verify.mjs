import * as price from './src/price.js'
import { strict as assert } from 'node:assert'

assert.equal(typeof price.total, 'function', 'total must remain exported')
const extracted = Object.keys(price).filter((name) => name !== 'total')
assert.ok(extracted.length >= 2, `expected discount and tax to be extracted, found ${extracted.length} other exports`)

const cases = [
  [[{ price: 10, quantity: 2 }], 0, 21.6],
  [[{ price: 10, quantity: 2 }], 1, 20.52],
  [[{ price: 10, quantity: 2 }], 5, 18.36],
  [[{ price: 19.99, quantity: 3 }], 1, 61.53],
  [[], 0, 0],
]
for (const [items, years, expected] of cases) {
  assert.equal(price.total(items, years), expected, `total(${JSON.stringify(items)}, ${years})`)
}
console.log('ok')
