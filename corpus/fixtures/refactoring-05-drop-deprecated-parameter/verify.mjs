import { strict as assert } from 'node:assert'
import { render } from './src/render.js'
import { body } from './src/page.js'
import { inline } from './src/inline.js'

assert.equal(render.length, 2, 'render must take value and indent only')
assert.equal(body({ a: 1 }), '  {"a":1}', 'the indent must still reach render')
assert.equal(inline({ a: 1 }), '{"a":1}', 'no indent means no leading spaces')
assert.equal(render('x', 1), ' "x"', 'indent is now the second parameter')
console.log('ok')
