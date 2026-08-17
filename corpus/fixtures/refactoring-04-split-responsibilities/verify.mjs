import { strict as assert } from 'node:assert'
import * as reportModule from './src/report.js'

const extra = Object.keys(reportModule).filter((name) => name !== 'Report')
assert.ok(extra.length >= 1, 'storage must be extracted into its own exported class')

const report = new reportModule.Report()
assert.equal(report.format({ name: 'a', value: 1 }), 'a: 1')
assert.equal(report.format({ name: 'b', value: 2 }), 'b: 2')
assert.deepEqual(report.all(), ['a: 1', 'b: 2'])

const snapshot = report.all()
snapshot.push('injected')
assert.deepEqual(report.all(), ['a: 1', 'b: 2'], 'all() must keep returning a copy')

report.reset()
assert.deepEqual(report.all(), [])
assert.deepEqual(
  new reportModule.Report().all(),
  [],
  'a fresh report must not share storage with an earlier one',
)
console.log('ok')
