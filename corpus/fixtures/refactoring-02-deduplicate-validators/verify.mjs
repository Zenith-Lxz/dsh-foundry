import { strict as assert } from 'node:assert'
import * as validate from './src/validate.js'

const extracted = Object.keys(validate).filter((name) => !['username', 'slug', 'tag'].includes(name))
assert.ok(extracted.length >= 1, 'the shared check must be extracted and exported')

assert.equal(validate.username('ab'), 'username must be 3-20 characters')
assert.equal(validate.username('a'.repeat(21)), 'username must be 3-20 characters')
assert.equal(validate.username('Ab1'), 'username may use a-z, 0-9, and underscore')
assert.equal(validate.username('ok_1'), null)

assert.equal(validate.slug('ab'), 'slug must be 3-40 characters')
assert.equal(validate.slug('a'.repeat(41)), 'slug must be 3-40 characters')
assert.equal(validate.slug('a'.repeat(40)), null, 'forty is still allowed')
assert.equal(validate.slug('Bad'), 'slug may use a-z, 0-9, and underscore')

assert.equal(validate.tag(''), 'tag must be 1-20 characters')
assert.equal(validate.tag('a'), null, 'a single character tag is allowed')
assert.equal(validate.tag('a'.repeat(21)), 'tag must be 1-20 characters')
console.log('ok')
