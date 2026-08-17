import { strict as assert } from 'node:assert'
import { settingOr } from './src/settings.js'

const settings = { retries: 0, prefix: '', verbose: false, name: 'x' }
assert.equal(settingOr(settings, 'retries', 3), 0, 'zero is a real value')
assert.equal(settingOr(settings, 'prefix', 'p'), '', 'an empty string is a real value')
assert.equal(settingOr(settings, 'verbose', true), false, 'false is a real value')
assert.equal(settingOr(settings, 'name', 'y'), 'x', 'an ordinary value')
assert.equal(settingOr(settings, 'missing', 'fallback'), 'fallback', 'a missing key still falls back')
assert.equal(settingOr({ explicit: undefined }, 'explicit', 'fallback'), 'fallback', 'an explicit undefined falls back')
console.log('ok')
