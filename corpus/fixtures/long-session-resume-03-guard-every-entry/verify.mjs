import { strict as assert } from 'node:assert'
import { readdirSync } from 'node:fs'

const modules = readdirSync('src').filter((name) => name.endsWith('.js'))
assert.equal(modules.length, 12, 'expected 12 modules')

for (const file of modules) {
  const { handle } = await import('./src/' + file)
  const name = file.slice(0, -3)
  assert.equal(handle(null), 'skipped', 'src/' + file + ' must skip null')
  assert.equal(handle(undefined), 'skipped', 'src/' + file + ' must skip undefined')
  assert.match(handle({ id: 'x' }), new RegExp('^' + name + ':x:'), 'src/' + file + ' must be unchanged for a real payload')
}
console.log('ok')
