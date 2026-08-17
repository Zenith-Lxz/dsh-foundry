import { line } from './src/app.js'
import { strict as assert } from 'node:assert'

assert.equal(line({ title: 'a', amount: 1 }), 'a=1')
console.log('ok')
