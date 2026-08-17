import { strict as assert } from 'node:assert'
import { pathEntries, resolveCommand } from './src/command.js'
import { readFileSync } from 'node:fs'
import { delimiter } from 'node:path'

const value = ['one', 'two', 'three'].join(delimiter)
assert.deepEqual(pathEntries(value), ['one', 'two', 'three'], 'entries split on the platform delimiter')
assert.deepEqual(pathEntries(''), [], 'an empty PATH has no entries')
assert.deepEqual(pathEntries(delimiter + 'one' + delimiter), ['one'], 'empty entries are dropped')
assert.equal(resolveCommand(value, (entry) => entry === 'two'), 'two')
assert.equal(resolveCommand(value, () => false), null, 'nothing found')

// On POSIX a hardcoded colon happens to be correct, so the behavior checks
// above cannot separate a real fix from a lucky one on this host.
const source = readFileSync('src/command.js', 'utf8')
assert.doesNotMatch(source, /split\(['"][:;]['"]\)/, 'the delimiter must come from the runtime, not a literal')
console.log('ok')
