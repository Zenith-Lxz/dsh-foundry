/**
 * Repository-navigation tasks.
 *
 * Every fixture carries a decoy that a name search finds first, so the oracle
 * separates tracing a real path from matching an identifier.
 * @module scripts/corpus/navigation
 */
import { ORACLE_HEADER, task, type TaskSpec } from './types.ts'

export const NAVIGATION: readonly TaskSpec[] = [
  {
    manifest: task({
      id: 'repository-navigation-02-effective-handler',
      category: 'repository-navigation',
      prompt: 'Two modules define a handler for the "sync" event, but only one is registered. Write the name of the registered handler function alone to ANSWER.txt.',
      allowedScope: ['ANSWER.txt'],
      rationale: 'Both candidates match a search for "sync". Only the registry tells them apart.',
    }),
    files: {
      'src/handlers/legacy.js': `/** Handles the sync event. Superseded. */
export function handleSyncLegacy(event) {
  return event
}
`,
      'src/handlers/current.js': `/** Handles the sync event. */
export function performSync(event) {
  return event
}
`,
      'src/registry.js': `import { performSync } from './handlers/current.js'

export const handlers = new Map([['sync', performSync]])
`,
      'verify.mjs': `${ORACLE_HEADER}import { readFileSync } from 'node:fs'

assert.equal(readFileSync('ANSWER.txt', 'utf8').trim(), 'performSync')
console.log('ok')
`,
    },
    solution: { 'ANSWER.txt': 'performSync\n' },
  },
  {
    manifest: task({
      id: 'repository-navigation-03-caller-count',
      category: 'repository-navigation',
      prompt: 'How many modules under src/ actually call `emit`? Write the number alone to ANSWER.txt. Importing without calling does not count, and neither does defining it.',
      allowedScope: ['ANSWER.txt'],
      rationale: 'Two decoys exist: a module that imports without calling, and a comment mentioning the name. A grep count returns the wrong answer.',
    }),
    files: {
      'src/bus.js': `/** Emit an event. */
export function emit(name) {
  return name
}
`,
      'src/a.js': `import { emit } from './bus.js'
export const run = () => emit('a')
`,
      'src/b.js': `import { emit } from './bus.js'
export const run = () => emit('b')
`,
      'src/c.js': `import { emit } from './bus.js'
/** Reserved: this module will emit once the queue lands. */
export const run = () => 'c'
`,
      'src/d.js': `/** Does not emit; kept so the count is not simply the file total. */
export const run = () => 'd'
`,
      'verify.mjs': `${ORACLE_HEADER}import { readFileSync } from 'node:fs'

assert.equal(Number(readFileSync('ANSWER.txt', 'utf8').trim()), 2)
console.log('ok')
`,
    },
    solution: { 'ANSWER.txt': '2\n' },
  },
  {
    manifest: task({
      id: 'repository-navigation-04-real-entry-point',
      category: 'repository-navigation',
      prompt: 'Which file runs when someone types the `demo` command from this package? Write its path relative to the workspace root, alone, to ANSWER.txt.',
      allowedScope: ['ANSWER.txt'],
      rationale: 'The manifest `main` field points elsewhere; only `bin` decides what the command runs.',
    }),
    files: {
      'package.json': `{
  "name": "demo-package",
  "type": "module",
  "main": "src/library.js",
  "bin": { "demo": "src/cli/start.js" }
}
`,
      'src/library.js': `export const value = 1
`,
      'src/cli/start.js': `#!/usr/bin/env node
console.log('demo')
`,
      'src/index.js': `export * from './library.js'
`,
      'verify.mjs': `${ORACLE_HEADER}import { readFileSync } from 'node:fs'

const answer = readFileSync('ANSWER.txt', 'utf8').trim().replace(/\\\\/g, '/')
assert.equal(answer.replace(/^\\.\\//, ''), 'src/cli/start.js')
console.log('ok')
`,
    },
    solution: { 'ANSWER.txt': 'src/cli/start.js\n' },
  },
  {
    manifest: task({
      id: 'repository-navigation-05-unreferenced-export',
      category: 'repository-navigation',
      prompt: 'One export in src/util.js is never referenced anywhere in src/. Write its name alone to ANSWER.txt. Do not delete anything.',
      allowedScope: ['ANSWER.txt'],
      rationale: 'One decoy is referenced only inside its own module and one only from a comment, so a naive occurrence count picks the wrong export.',
    }),
    files: {
      'src/util.js': `/** Used by the report. */
export function formatDate(value) {
  return String(value)
}

/** Used only inside this module. */
export function pad(value) {
  return String(value).padStart(2, '0')
}

/** Never referenced. */
export function slugify(value) {
  return String(value).toLowerCase()
}

/** Uses pad, so pad is referenced. */
export function clock(hours) {
  return pad(hours) + ':00'
}
`,
      'src/report.js': `import { formatDate, clock } from './util.js'

/** Render a report line. Someday this may also slugify the title. */
export function line(date) {
  return formatDate(date) + ' ' + clock(9)
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { readFileSync } from 'node:fs'

assert.equal(readFileSync('ANSWER.txt', 'utf8').trim(), 'slugify')
console.log('ok')
`,
    },
    solution: { 'ANSWER.txt': 'slugify\n' },
  },
]
