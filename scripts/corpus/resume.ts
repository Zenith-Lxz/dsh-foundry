/**
 * Long-session-resume tasks.
 *
 * Each spans enough repetitive files that the work outlives a single context
 * window. The oracle fails on any surviving callsite, so an agent that loses
 * track partway cannot pass by finishing most of them.
 * @module scripts/corpus/resume
 */
import { ORACLE_HEADER, task, type TaskSpec } from './types.ts'

/** The module names every sweep task repeats over. */
const MODULES = [
  'auth', 'billing', 'cache', 'email', 'export', 'import',
  'queue', 'report', 'search', 'upload', 'webhook', 'worker',
]

/**
 * Capitalize a module name for a function identifier.
 * @param name - Module name.
 * @returns The capitalized name.
 */
function cap(name: string): string {
  return `${name[0]!.toUpperCase()}${name.slice(1)}`
}

/**
 * Build one file per module.
 * @param body - Produces the file body from the module name and its index.
 * @returns The files, keyed by path.
 */
function perModule(body: (name: string, index: number) => string): Record<string, string> {
  return Object.fromEntries(MODULES.map((name, index) => [`src/${name}.js`, body(name, index)]))
}

export const RESUME: readonly TaskSpec[] = [
  {
    manifest: task({
      id: 'long-session-resume-02-named-exports',
      category: 'long-session-resume',
      prompt: 'Every module under src/ except index.js uses a default export. Convert each to a named export matching its function name, and update src/index.js to re-export them by name.',
      allowedScope: ['src'],
      rationale: 'Twelve mechanical conversions plus one aggregating file that must stay consistent with all of them. The oracle imports every name from the index.',
    }),
    files: {
      ...perModule((name, index) => `/** Run the ${name} step. */
export default function run${cap(name)}() {
  return '${name}:${index + 1}'
}
`),
      'src/index.js': MODULES.map((name) => `export { default as run${cap(name)} } from './${name}.js'`).join('\n') + '\n',
      'verify.mjs': `${ORACLE_HEADER}import { readFileSync, readdirSync } from 'node:fs'
import * as index from './src/index.js'

const modules = readdirSync('src').filter((name) => name.endsWith('.js') && name !== 'index.js')
assert.equal(modules.length, ${MODULES.length}, 'expected ${MODULES.length} modules')

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
`,
    },
    solution: {
      ...perModule((name, index) => `/** Run the ${name} step. */
export function run${cap(name)}() {
  return '${name}:${index + 1}'
}
`),
      'src/index.js': MODULES.map((name) => `export { run${cap(name)} } from './${name}.js'`).join('\n') + '\n',
    },
  },
  {
    manifest: task({
      id: 'long-session-resume-03-guard-every-entry',
      category: 'long-session-resume',
      prompt: 'Every `handle` function under src/ crashes on a null input. Make each return the string "skipped" for null or undefined, without changing what it returns for a real input.',
      allowedScope: ['src'],
      rationale: 'Twelve near-identical files where one already has a partial guard that must not be duplicated or broken. Every file is checked for both paths.',
    }),
    files: {
      ...perModule((name, index) => name === 'cache'
        ? `/** Handle a ${name} payload. */
export function handle(payload) {
  if (payload === undefined) return 'skipped'
  return '${name}:' + payload.id + ':${index + 1}'
}
`
        : `/** Handle a ${name} payload. */
export function handle(payload) {
  return '${name}:' + payload.id + ':${index + 1}'
}
`),
      'verify.mjs': `${ORACLE_HEADER}import { readdirSync } from 'node:fs'

const modules = readdirSync('src').filter((name) => name.endsWith('.js'))
assert.equal(modules.length, ${MODULES.length}, 'expected ${MODULES.length} modules')

for (const file of modules) {
  const { handle } = await import('./src/' + file)
  const name = file.slice(0, -3)
  assert.equal(handle(null), 'skipped', 'src/' + file + ' must skip null')
  assert.equal(handle(undefined), 'skipped', 'src/' + file + ' must skip undefined')
  assert.match(handle({ id: 'x' }), new RegExp('^' + name + ':x:'), 'src/' + file + ' must be unchanged for a real payload')
}
console.log('ok')
`,
    },
    solution: {
      ...perModule((name, index) => `/** Handle a ${name} payload. */
export function handle(payload) {
  if (payload === null || payload === undefined) return 'skipped'
  return '${name}:' + payload.id + ':${index + 1}'
}
`),
    },
  },
  {
    manifest: task({
      id: 'long-session-resume-04-error-type-migration',
      category: 'long-session-resume',
      prompt: 'Replace every `throw new Error(...)` under src/ with `throw new StepError(step, message)` from src/errors.js, keeping each message exactly as it is now.',
      allowedScope: ['src'],
      rationale: 'Twelve throw sites whose messages must survive verbatim while the type changes. An agent that rewrites the messages while migrating fails.',
    }),
    files: {
      'src/errors.js': `/** Raised when a step fails. */
export class StepError extends Error {
  constructor(step, message) {
    super(message)
    this.step = step
  }
}
`,
      ...perModule((name, index) => `/** Run the ${name} step. */
export function run${cap(name)}(ok) {
  if (!ok) throw new Error('${name} failed at stage ${index + 1}')
  return '${name}'
}
`),
      'verify.mjs': `${ORACLE_HEADER}import { readdirSync } from 'node:fs'
import { StepError } from './src/errors.js'

const modules = readdirSync('src').filter((name) => name.endsWith('.js') && name !== 'errors.js')
assert.equal(modules.length, ${MODULES.length}, 'expected ${MODULES.length} modules')

const expected = ${JSON.stringify(Object.fromEntries(MODULES.map((name, index) => [name, `${name} failed at stage ${index + 1}`])))}

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
`,
    },
    solution: {
      ...perModule((name, index) => `import { StepError } from './errors.js'

/** Run the ${name} step. */
export function run${cap(name)}(ok) {
  if (!ok) throw new StepError('${name}', '${name} failed at stage ${index + 1}')
  return '${name}'
}
`),
    },
  },
  {
    manifest: task({
      id: 'long-session-resume-05-consistent-bug-sweep',
      category: 'long-session-resume',
      prompt: 'Every module under src/ has the same bug: `pick` returns the fallback when the requested index is 0. Fix it in every module without changing anything else.',
      allowedScope: ['src'],
      rationale: 'The same one-line defect twelve times, where three modules have superficially different formatting. A search-and-replace on one spelling leaves the others broken.',
    }),
    files: {
      ...perModule((name, index) => index % 4 === 1
        ? `/** Pick a value from the ${name} list. */
export function pick(values, index, fallback) {
  if (!index) {
    return fallback
  }
  return values[index] ?? fallback
}
`
        : index % 4 === 2
          ? `/** Pick a value from the ${name} list. */
export const pick = (values, index, fallback) => (index ? values[index] ?? fallback : fallback)
`
          : `/** Pick a value from the ${name} list. */
export function pick(values, index, fallback) {
  return index ? values[index] ?? fallback : fallback
}
`),
      'verify.mjs': `${ORACLE_HEADER}import { readdirSync } from 'node:fs'

const modules = readdirSync('src').filter((name) => name.endsWith('.js'))
assert.equal(modules.length, ${MODULES.length}, 'expected ${MODULES.length} modules')

for (const file of modules) {
  const { pick } = await import('./src/' + file)
  assert.equal(pick(['a', 'b'], 0, 'z'), 'a', 'src/' + file + ' must return index 0')
  assert.equal(pick(['a', 'b'], 1, 'z'), 'b', 'src/' + file + ' must still return other indexes')
  assert.equal(pick(['a', 'b'], 5, 'z'), 'z', 'src/' + file + ' must still fall back past the end')
  assert.equal(pick([], 0, 'z'), 'z', 'src/' + file + ' must fall back on an empty list')
}
console.log('ok')
`,
    },
    solution: {
      ...perModule((name) => `/** Pick a value from the ${name} list. */
export function pick(values, index, fallback) {
  return values[index] ?? fallback
}
`),
    },
  },
]
