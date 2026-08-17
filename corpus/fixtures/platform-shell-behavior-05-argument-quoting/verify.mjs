import { strict as assert } from 'node:assert'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { runTool } from './src/run.js'

const dir = join(process.cwd(), 'a directory with spaces')
mkdirSync(dir, { recursive: true })
const script = join(dir, 'echo.mjs')
writeFileSync(script, 'console.log(process.argv[2] ?? "")\n')

const target = join(dir, 'a file with spaces.txt')
writeFileSync(target, 'x')

assert.equal(runTool(process.execPath, script), '', 'running with no extra argument still works')

const source = readFileSync('src/run.js', 'utf8')
assert.doesNotMatch(source, /execSync/, 'a shell string cannot be quoted correctly on every platform')

const output = runToolWithArg(process.execPath, [script, target])
assert.equal(output, target, 'the spaced path must arrive intact')

/**
 * Call runTool with a list, whichever way it now accepts one.
 * @param command - Executable.
 * @param args - Argument list.
 * @returns The trimmed output.
 */
function runToolWithArg(command, args) {
  return runTool(command, args.length === 1 ? args[0] : args)
}
console.log('ok')
