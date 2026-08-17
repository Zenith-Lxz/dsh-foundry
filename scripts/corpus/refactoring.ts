/**
 * Refactoring tasks.
 *
 * Each oracle checks a structural requirement *and* every original result,
 * including a case a plausible rewrite changes. Structure alone would accept a
 * refactor that quietly altered behavior, which is the failure these tasks
 * exist to catch.
 * @module scripts/corpus/refactoring
 */
import { ORACLE_HEADER, task, type TaskSpec } from './types.ts'

export const REFACTORING: readonly TaskSpec[] = [
  {
    manifest: task({
      id: 'refactoring-02-deduplicate-validators',
      category: 'refactoring',
      prompt: 'src/validate.js repeats the same length-and-charset check three times. Extract it into one shared helper, exported, and keep every message identical.',
      allowedScope: ['src'],
      rationale: 'The three copies differ in one bound. A careless extraction unifies them and changes one message, which the oracle checks exactly.',
    }),
    files: {
      'src/validate.js': `/** Validate a username. */
export function username(value) {
  if (value.length < 3 || value.length > 20) return 'username must be 3-20 characters'
  if (!/^[a-z0-9_]+$/.test(value)) return 'username may use a-z, 0-9, and underscore'
  return null
}

/** Validate a project slug. */
export function slug(value) {
  if (value.length < 3 || value.length > 40) return 'slug must be 3-40 characters'
  if (!/^[a-z0-9_]+$/.test(value)) return 'slug may use a-z, 0-9, and underscore'
  return null
}

/** Validate a tag. */
export function tag(value) {
  if (value.length < 1 || value.length > 20) return 'tag must be 1-20 characters'
  if (!/^[a-z0-9_]+$/.test(value)) return 'tag may use a-z, 0-9, and underscore'
  return null
}
`,
      'verify.mjs': `${ORACLE_HEADER}import * as validate from './src/validate.js'

const extracted = Object.keys(validate).filter((name) => !['username', 'slug', 'tag'].includes(name))
assert.ok(extracted.length >= 1, 'the shared check must be extracted and exported')

assert.equal(validate.username('ab'), 'username must be 3-20 characters')
assert.equal(validate.username('a'.repeat(21)), 'username must be 3-20 characters')
assert.equal(validate.username('Ab1'), 'username may use a-z, 0-9, and underscore')
assert.equal(validate.username('ok_1'), null)

assert.equal(validate.slug('ab'), 'slug must be 3-40 characters')
assert.equal(validate.slug('a'.repeat(41)), 'slug must be 3-40 characters')
assert.equal(validate.slug('a'.repeat(40)), null, 'forty is still allowed')
assert.equal(validate.slug('Bad'), 'slug may use a-z, 0-9, and underscore')

assert.equal(validate.tag(''), 'tag must be 1-20 characters')
assert.equal(validate.tag('a'), null, 'a single character tag is allowed')
assert.equal(validate.tag('a'.repeat(21)), 'tag must be 1-20 characters')
console.log('ok')
`,
    },
    solution: {
      'src/validate.js': `/** Check length and charset, producing the field's own messages. */
export function checkField(label, value, min, max) {
  if (value.length < min || value.length > max) return label + ' must be ' + min + '-' + max + ' characters'
  if (!/^[a-z0-9_]+$/.test(value)) return label + ' may use a-z, 0-9, and underscore'
  return null
}

/** Validate a username. */
export function username(value) {
  return checkField('username', value, 3, 20)
}

/** Validate a project slug. */
export function slug(value) {
  return checkField('slug', value, 3, 40)
}

/** Validate a tag. */
export function tag(value) {
  return checkField('tag', value, 1, 20)
}
`,
    },
  },
  {
    manifest: task({
      id: 'refactoring-03-callback-to-async',
      category: 'refactoring',
      prompt: 'Convert `load` in src/load.js from a callback API to an async function returning a promise, preserving exactly which inputs fail and with what message.',
      allowedScope: ['src'],
      rationale: 'The callback form reports a missing key and an invalid key differently. A rewrite that collapses them passes a happy-path check and fails here.',
    }),
    files: {
      'src/load.js': `const data = { a: 1, b: 2 }

/** Load a key, calling back with (error, value). */
export function load(key, callback) {
  if (typeof key !== 'string') {
    callback(new Error('key must be a string'))
    return
  }
  if (!(key in data)) {
    callback(new Error('unknown key: ' + key))
    return
  }
  callback(null, data[key])
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { load } from './src/load.js'

const result = load('a')
assert.ok(result instanceof Promise, 'load must return a promise')
assert.equal(await result, 1)
assert.equal(await load('b'), 2)

await assert.rejects(load('zz'), { message: 'unknown key: zz' }, 'an unknown key keeps its message')
await assert.rejects(load(42), { message: 'key must be a string' }, 'a bad key type keeps its own message')
assert.equal(load.length, 1, 'the callback parameter must be gone')
console.log('ok')
`,
    },
    solution: {
      'src/load.js': `const data = { a: 1, b: 2 }

/** Load a key. */
export async function load(key) {
  if (typeof key !== 'string') throw new Error('key must be a string')
  if (!(key in data)) throw new Error('unknown key: ' + key)
  return data[key]
}
`,
    },
  },
  {
    manifest: task({
      id: 'refactoring-04-split-responsibilities',
      category: 'refactoring',
      prompt: 'The Report class in src/report.js both formats and stores. Split storage into its own exported class, keeping the Report public methods and their results unchanged.',
      allowedScope: ['src'],
      rationale: 'The oracle pins the existing public surface, so a split that renames or drops a method fails even though the new structure looks right.',
    }),
    files: {
      'src/report.js': `/** Formats rows and remembers what it produced. */
export class Report {
  constructor() {
    this.history = []
  }

  /** Format one row. */
  format(row) {
    const line = row.name + ': ' + row.value
    this.history.push(line)
    return line
  }

  /** Every line produced so far. */
  all() {
    return [...this.history]
  }

  /** Forget everything produced so far. */
  reset() {
    this.history = []
  }
}
`,
      'verify.mjs': `${ORACLE_HEADER}import * as reportModule from './src/report.js'

const extra = Object.keys(reportModule).filter((name) => name !== 'Report')
assert.ok(extra.length >= 1, 'storage must be extracted into its own exported class')

const report = new reportModule.Report()
assert.equal(report.format({ name: 'a', value: 1 }), 'a: 1')
assert.equal(report.format({ name: 'b', value: 2 }), 'b: 2')
assert.deepEqual(report.all(), ['a: 1', 'b: 2'])

const snapshot = report.all()
snapshot.push('injected')
assert.deepEqual(report.all(), ['a: 1', 'b: 2'], 'all() must keep returning a copy')

report.reset()
assert.deepEqual(report.all(), [])
assert.deepEqual(
  new reportModule.Report().all(),
  [],
  'a fresh report must not share storage with an earlier one',
)
console.log('ok')
`,
    },
    solution: {
      'src/report.js': `/** Remembers produced lines. */
export class History {
  constructor() {
    this.lines = []
  }

  /** Record one line. */
  add(line) {
    this.lines.push(line)
  }

  /** Every line recorded so far. */
  all() {
    return [...this.lines]
  }

  /** Forget everything recorded so far. */
  clear() {
    this.lines = []
  }
}

/** Formats rows. */
export class Report {
  constructor() {
    this.history = new History()
  }

  /** Format one row. */
  format(row) {
    const line = row.name + ': ' + row.value
    this.history.add(line)
    return line
  }

  /** Every line produced so far. */
  all() {
    return this.history.all()
  }

  /** Forget everything produced so far. */
  reset() {
    this.history.clear()
  }
}
`,
    },
  },
  {
    manifest: task({
      id: 'refactoring-05-drop-deprecated-parameter',
      category: 'refactoring',
      prompt: 'The `legacy` parameter of `render` in src/render.js is always false at every callsite. Remove the parameter and the branch it guards, and update every caller.',
      allowedScope: ['src'],
      rationale: 'One caller passes the argument positionally after another parameter, so removing it naively shifts the remaining arguments — which the oracle detects.',
    }),
    files: {
      'src/render.js': `/** Render a value. */
export function render(value, legacy, indent) {
  if (legacy) return String(value)
  return ' '.repeat(indent ?? 0) + JSON.stringify(value)
}
`,
      'src/page.js': `import { render } from './render.js'

/** Render a page body. */
export function body(value) {
  return render(value, false, 2)
}
`,
      'src/inline.js': `import { render } from './render.js'

/** Render inline, with no indent. */
export function inline(value) {
  return render(value, false)
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { render } from './src/render.js'
import { body } from './src/page.js'
import { inline } from './src/inline.js'

assert.equal(render.length, 2, 'render must take value and indent only')
assert.equal(body({ a: 1 }), '  {"a":1}', 'the indent must still reach render')
assert.equal(inline({ a: 1 }), '{"a":1}', 'no indent means no leading spaces')
assert.equal(render('x', 1), ' "x"', 'indent is now the second parameter')
console.log('ok')
`,
    },
    solution: {
      'src/render.js': `/** Render a value. */
export function render(value, indent) {
  return ' '.repeat(indent ?? 0) + JSON.stringify(value)
}
`,
      'src/page.js': `import { render } from './render.js'

/** Render a page body. */
export function body(value) {
  return render(value, 2)
}
`,
      'src/inline.js': `import { render } from './render.js'

/** Render inline, with no indent. */
export function inline(value) {
  return render(value)
}
`,
    },
  },
]
