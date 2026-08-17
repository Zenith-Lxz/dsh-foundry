import { readFileSync, readdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import * as logModule from './src/log.js'

assert.equal(logModule.oldLog, undefined, 'the old export must be deleted')

const modules = readdirSync('src').filter((name) => name.endsWith('.js') && name !== 'log.js')
assert.equal(modules.length, 10, `expected 10 callsite modules, found ${modules.length}`)
for (const name of modules) {
  const source = readFileSync(`src/${name}`, 'utf8')
  assert.doesNotMatch(source, /oldLog/, `src/${name} still calls oldLog`)
}
for (const name of modules) {
  const imported = await import(`./src/${name}`)
  const announce = Object.values(imported).find((value) => typeof value === 'function')
  assert.match(announce(), /^\[info\] /, `src/${name} must still produce the same output`)
}
console.log('ok')
