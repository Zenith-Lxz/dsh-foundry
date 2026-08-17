import { strict as assert } from 'node:assert'
import { readFileSync, readdirSync } from 'node:fs'
import * as index from './src/index.js'

const modules = readdirSync('src').filter((name) => name.endsWith('.js') && name !== 'index.js')
assert.equal(modules.length, 12, 'expected 12 modules')

for (const file of modules) {
  const source = readFileSync('src/' + file, 'utf8')
  assert.doesNotMatch(source, /export default/, 'src/' + file + ' still has a default export')
  const imported = await import('./src/' + file)
  assert.equal(imported.default, undefined, 'src/' + file + ' must not export a default')
}

for (const file of modules) {
  const name = file.slice(0, -3)
  const identifier = 'run' + name[0].toUpperCase() + name.slice(1)
  assert.equal(typeof index[identifier], 'function', 'index.js must re-export ' + identifier)
  assert.match(index[identifier](), new RegExp('^' + name + ':'), identifier + ' must behave as before')
}
console.log('ok')
