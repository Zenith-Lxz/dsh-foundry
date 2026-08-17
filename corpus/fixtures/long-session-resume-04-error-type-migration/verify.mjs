import { strict as assert } from 'node:assert'
import { readdirSync } from 'node:fs'
import { StepError } from './src/errors.js'

const modules = readdirSync('src').filter((name) => name.endsWith('.js') && name !== 'errors.js')
assert.equal(modules.length, 12, 'expected 12 modules')

const expected = {"auth":"auth failed at stage 1","billing":"billing failed at stage 2","cache":"cache failed at stage 3","email":"email failed at stage 4","export":"export failed at stage 5","import":"import failed at stage 6","queue":"queue failed at stage 7","report":"report failed at stage 8","search":"search failed at stage 9","upload":"upload failed at stage 10","webhook":"webhook failed at stage 11","worker":"worker failed at stage 12"}

for (const file of modules) {
  const name = file.slice(0, -3)
  const imported = await import('./src/' + file)
  const run = Object.values(imported).find((value) => typeof value === 'function')
  assert.equal(run(true), name, 'src/' + file + ' must still succeed the same way')
  try {
    run(false)
    assert.fail('src/' + file + ' must still throw')
  } catch (error) {
    assert.ok(error instanceof StepError, 'src/' + file + ' must throw StepError')
    assert.equal(error.message, expected[name], 'src/' + file + ' must keep its message verbatim')
    assert.equal(error.step, name, 'src/' + file + ' must pass its step name')
  }
}
console.log('ok')
