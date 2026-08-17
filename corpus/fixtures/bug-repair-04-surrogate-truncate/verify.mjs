import { strict as assert } from 'node:assert'
import { truncate } from './src/truncate.js'

assert.equal(truncate('hello', 10), 'hello', 'short text is unchanged')
assert.equal(truncate('hello', 3), 'hel', 'ascii cuts as before')

const emoji = 'ab' + String.fromCodePoint(0x1f600) + 'cd'
for (let max = 1; max <= emoji.length; max += 1) {
  const cut = truncate(emoji, max)
  for (const unit of cut) {
    const code = unit.codePointAt(0)
    assert.ok(
      code < 0xd800 || code > 0xdfff,
      'truncate(' + JSON.stringify(emoji) + ', ' + max + ') left a lone surrogate: ' + JSON.stringify(cut),
    )
  }
  assert.ok([...cut].length <= max, 'result must not exceed max characters')
}
console.log('ok')
