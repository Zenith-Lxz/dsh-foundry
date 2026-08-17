import { order } from './src/order.js'
import { strict as assert } from 'node:assert'

const records = [
  { name: 'e', priority: 5 },
  { name: 'a', priority: 1 },
  { name: 'd', priority: 4 },
  { name: 'b', priority: 2 },
  { name: 'c', priority: 3 },
]
assert.deepEqual(order(records).map((record) => record.name), ['a', 'b', 'c', 'd', 'e'])
console.log('ok')
