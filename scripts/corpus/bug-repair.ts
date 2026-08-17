/**
 * Bug-repair tasks.
 *
 * Each fixture holds a defect that the obvious example does not expose, so an
 * agent that reproduces the example it was shown fails the oracle. That is the
 * behavior these tasks exist to measure.
 * @module scripts/corpus/bug-repair
 */
import { ORACLE_HEADER, task, type TaskSpec } from './types.ts'

export const BUG_REPAIR: readonly TaskSpec[] = [
  {
    manifest: task({
      id: 'bug-repair-02-inclusive-range',
      category: 'bug-repair',
      prompt: 'parseRange in src/range.js should expand "1-5" to every number from 1 through 5 inclusive. It drops the last value. Fix it.',
      allowedScope: ['src'],
      rationale: 'The off-by-one is invisible for a single-element range. The oracle checks inclusivity, a descending range, and a negative bound.',
    }),
    files: {
      'src/range.js': `/** Expand "a-b" into every number in the range. */
export function parseRange(text) {
  const [start, end] = text.split('-').map(Number)
  const out = []
  for (let value = start; value < end; value += 1) out.push(value)
  return out
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { parseRange } from './src/range.js'

assert.deepEqual(parseRange('1-5'), [1, 2, 3, 4, 5], 'the end must be included')
assert.deepEqual(parseRange('3-3'), [3], 'a single-element range')
assert.deepEqual(parseRange('0-2'), [0, 1, 2], 'a zero start')
assert.deepEqual(parseRange('7-4'), [], 'a descending range yields nothing')
console.log('ok')
`,
    },
    solution: {
      'src/range.js': `/** Expand "a-b" into every number in the range. */
export function parseRange(text) {
  const [start, end] = text.split('-').map(Number)
  const out = []
  for (let value = start; value <= end; value += 1) out.push(value)
  return out
}
`,
    },
  },
  {
    manifest: task({
      id: 'bug-repair-03-mutating-merge',
      category: 'bug-repair',
      prompt: 'deepMerge in src/merge.js corrupts its first argument. Callers expect both inputs to be left alone. Fix it.',
      allowedScope: ['src'],
      rationale: 'Aliasing damage is invisible when the result is the only thing inspected. The oracle checks both inputs afterwards and checks a nested object.',
    }),
    files: {
      'src/merge.js': `/** Merge source into a copy of target. */
export function deepMerge(target, source) {
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      target[key] = deepMerge(target[key] ?? {}, source[key])
    } else {
      target[key] = source[key]
    }
  }
  return target
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { deepMerge } from './src/merge.js'

const target = { a: 1, nested: { x: 1 } }
const source = { b: 2, nested: { y: 2 } }
const merged = deepMerge(target, source)

assert.deepEqual(merged, { a: 1, b: 2, nested: { x: 1, y: 2 } }, 'the merged result')
assert.deepEqual(target, { a: 1, nested: { x: 1 } }, 'the first input must be unchanged')
assert.deepEqual(source, { b: 2, nested: { y: 2 } }, 'the second input must be unchanged')
merged.nested.z = 3
assert.equal(target.nested.z, undefined, 'the result must not alias the input')
console.log('ok')
`,
    },
    solution: {
      'src/merge.js': `/** Merge source into a copy of target. */
export function deepMerge(target, source) {
  const out = { ...target }
  for (const key of Object.keys(source)) {
    if (source[key] !== null && typeof source[key] === 'object' && !Array.isArray(source[key])) {
      out[key] = deepMerge(out[key] ?? {}, source[key])
    } else {
      out[key] = source[key]
    }
  }
  return out
}
`,
    },
  },
  {
    manifest: task({
      id: 'bug-repair-04-surrogate-truncate',
      category: 'bug-repair',
      prompt: 'truncate in src/truncate.js splits emoji in half when it cuts text. Make it cut on whole characters.',
      allowedScope: ['src'],
      rationale: 'A plain slice passes for ASCII and breaks surrogate pairs. The oracle checks that the result contains no lone surrogate.',
    }),
    files: {
      'src/truncate.js': `/** Cut text to at most max characters. */
export function truncate(text, max) {
  return text.length <= max ? text : text.slice(0, max)
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { truncate } from './src/truncate.js'

assert.equal(truncate('hello', 10), 'hello', 'short text is unchanged')
assert.equal(truncate('hello', 3), 'hel', 'ascii cuts as before')

const emoji = 'ab' + String.fromCodePoint(0x1f600) + 'cd'
for (let max = 1; max <= emoji.length; max += 1) {
  const cut = truncate(emoji, max)
  for (const unit of cut) {
    const code = unit.codePointAt(0)
    assert.ok(
      code < 0xd800 || code > 0xdfff,
      'truncate(' + JSON.stringify(emoji) + ', ' + max + ') left a lone surrogate: ' + JSON.stringify(cut),
    )
  }
  assert.ok([...cut].length <= max, 'result must not exceed max characters')
}
console.log('ok')
`,
    },
    solution: {
      'src/truncate.js': `/** Cut text to at most max characters. */
export function truncate(text, max) {
  const characters = [...text]
  return characters.length <= max ? text : characters.slice(0, max).join('')
}
`,
    },
  },
  {
    manifest: task({
      id: 'bug-repair-05-zero-is-not-missing',
      category: 'bug-repair',
      prompt: 'settingOr in src/settings.js returns the fallback for a value the user really set. Fix it without changing the fallback behavior for genuinely absent keys.',
      allowedScope: ['src'],
      rationale: 'A falsy check treats 0, empty string, and false as absent. The oracle covers each falsy value plus a truly missing key.',
    }),
    files: {
      'src/settings.js': `/** Read a setting, falling back when it is absent. */
export function settingOr(settings, key, fallback) {
  return settings[key] || fallback
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { settingOr } from './src/settings.js'

const settings = { retries: 0, prefix: '', verbose: false, name: 'x' }
assert.equal(settingOr(settings, 'retries', 3), 0, 'zero is a real value')
assert.equal(settingOr(settings, 'prefix', 'p'), '', 'an empty string is a real value')
assert.equal(settingOr(settings, 'verbose', true), false, 'false is a real value')
assert.equal(settingOr(settings, 'name', 'y'), 'x', 'an ordinary value')
assert.equal(settingOr(settings, 'missing', 'fallback'), 'fallback', 'a missing key still falls back')
assert.equal(settingOr({ explicit: undefined }, 'explicit', 'fallback'), 'fallback', 'an explicit undefined falls back')
console.log('ok')
`,
    },
    solution: {
      'src/settings.js': `/** Read a setting, falling back when it is absent. */
export function settingOr(settings, key, fallback) {
  return settings[key] === undefined ? fallback : settings[key]
}
`,
    },
  },
]
