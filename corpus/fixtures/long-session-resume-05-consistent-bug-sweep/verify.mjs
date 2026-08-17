import { strict as assert } from 'node:assert'
import { readdirSync } from 'node:fs'

const modules = readdirSync('src').filter((name) => name.endsWith('.js'))
assert.equal(modules.length, 12, 'expected 12 modules')

for (const file of modules) {
  const { pick } = await import('./src/' + file)
  assert.equal(pick(['a', 'b'], 0, 'z'), 'a', 'src/' + file + ' must return index 0')
  assert.equal(pick(['a', 'b'], 1, 'z'), 'b', 'src/' + file + ' must still return other indexes')
  assert.equal(pick(['a', 'b'], 5, 'z'), 'z', 'src/' + file + ' must still fall back past the end')
  assert.equal(pick([], 0, 'z'), 'z', 'src/' + file + ' must fall back on an empty list')
}
console.log('ok')
