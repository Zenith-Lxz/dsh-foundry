/**
 * Multi-file feature tasks.
 *
 * Each requires a coordinated change across files where one file in the middle
 * must cooperate. Every oracle also re-checks the behavior that existed before,
 * because a feature that breaks an existing path is not a delivered feature.
 * @module scripts/corpus/feature
 */
import { ORACLE_HEADER, task, type TaskSpec } from './types.ts'

export const FEATURE: readonly TaskSpec[] = [
  {
    manifest: task({
      id: 'multi-file-feature-02-threaded-retry-option',
      category: 'multi-file-feature',
      prompt: 'Add an optional `retries` option to `request` in src/client.js that reaches `attempt` in src/transport.js through src/middleware.js. Default to 0 retries and keep the current behavior when it is not supplied.',
      allowedScope: ['src'],
      rationale: 'The middleware currently drops unknown options. The oracle counts real attempts, so an option that is accepted but never threaded through fails.',
    }),
    files: {
      'src/transport.js': `let failuresLeft = 0
let attempts = 0

/** Test seam: make the next n attempts fail. */
export function failNext(count) {
  failuresLeft = count
  attempts = 0
}

/** Attempts made since the last failNext. */
export function attemptCount() {
  return attempts
}

/** Perform one attempt. */
export function attempt(path) {
  attempts += 1
  if (failuresLeft > 0) {
    failuresLeft -= 1
    throw new Error('transport failed')
  }
  return 'ok:' + path
}
`,
      'src/middleware.js': `import { attempt } from './transport.js'

/** Apply middleware and perform the request. */
export function send(path) {
  return attempt(path)
}
`,
      'src/client.js': `import { send } from './middleware.js'

/** Make a request. */
export function request(path, options = {}) {
  return send(path)
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { request } from './src/client.js'
import { attemptCount, failNext } from './src/transport.js'

failNext(0)
assert.equal(request('/a'), 'ok:/a', 'the existing path is unchanged')
assert.equal(attemptCount(), 1, 'no retries by default')

failNext(1)
assert.throws(() => request('/b'), /transport failed/, 'without retries a failure still throws')

failNext(2)
assert.equal(request('/c', { retries: 2 }), 'ok:/c', 'two retries survive two failures')
assert.equal(attemptCount(), 3, 'one initial attempt plus two retries')

failNext(3)
assert.throws(() => request('/d', { retries: 1 }), /transport failed/, 'retries are bounded by the option')
console.log('ok')
`,
    },
    solution: {
      'src/middleware.js': `import { attempt } from './transport.js'

/** Apply middleware and perform the request, retrying as configured. */
export function send(path, retries = 0) {
  let lastError
  for (let tries = 0; tries <= retries; tries += 1) {
    try {
      return attempt(path)
    } catch (error) {
      lastError = error
    }
  }
  throw lastError
}
`,
      'src/client.js': `import { send } from './middleware.js'

/** Make a request. */
export function request(path, options = {}) {
  return send(path, options.retries ?? 0)
}
`,
    },
  },
  {
    manifest: task({
      id: 'multi-file-feature-03-pagination',
      category: 'multi-file-feature',
      prompt: 'Add `limit` and `offset` to `list` in src/api.js, applied in src/store.js, and have the response report the unpaginated `total`. Calling `list` with no options must behave exactly as it does now.',
      allowedScope: ['src'],
      rationale: 'The total must be the count before slicing. An implementation that returns the page length passes a single-page check and fails the multi-page case.',
    }),
    files: {
      'src/store.js': `const rows = [1, 2, 3, 4, 5, 6, 7]

/** Read rows. */
export function read() {
  return [...rows]
}
`,
      'src/api.js': `import { read } from './store.js'

/** List rows. */
export function list(options = {}) {
  return { items: read() }
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { list } from './src/api.js'

assert.deepEqual(list().items, [1, 2, 3, 4, 5, 6, 7], 'no options returns everything')
assert.equal(list().total, 7, 'total is reported even without paging')

const page = list({ limit: 3 })
assert.deepEqual(page.items, [1, 2, 3])
assert.equal(page.total, 7, 'total counts every row, not the page')

const second = list({ limit: 3, offset: 3 })
assert.deepEqual(second.items, [4, 5, 6])
assert.equal(second.total, 7)

const last = list({ limit: 3, offset: 6 })
assert.deepEqual(last.items, [7], 'a short final page')

const past = list({ limit: 3, offset: 99 })
assert.deepEqual(past.items, [], 'an offset past the end yields nothing')
assert.equal(past.total, 7, 'and still reports the true total')
console.log('ok')
`,
    },
    solution: {
      'src/store.js': `const rows = [1, 2, 3, 4, 5, 6, 7]

/** Read rows, optionally a page of them. */
export function read({ limit, offset = 0 } = {}) {
  const all = [...rows]
  const page = limit === undefined ? all.slice(offset) : all.slice(offset, offset + limit)
  return { page, total: all.length }
}
`,
      'src/api.js': `import { read } from './store.js'

/** List rows. */
export function list(options = {}) {
  const { page, total } = read(options)
  return { items: page, total }
}
`,
    },
  },
  {
    manifest: task({
      id: 'multi-file-feature-04-cache-with-invalidation',
      category: 'multi-file-feature',
      prompt: 'Cache `lookup` results in src/cache.js and use the cache from src/service.js. Writing through `save` must invalidate only the key it wrote.',
      allowedScope: ['src'],
      rationale: 'Invalidating everything on write also passes a naive check. The oracle proves one key survives a write to another.',
    }),
    files: {
      'src/source.js': `const data = new Map([['a', 1], ['b', 2]])
let reads = 0

/** Reads performed since the last resetReads. */
export function readCount() {
  return reads
}

/** Test seam. */
export function resetReads() {
  reads = 0
}

/** Read a key from the underlying source. */
export function read(key) {
  reads += 1
  return data.get(key)
}

/** Write a key to the underlying source. */
export function write(key, value) {
  data.set(key, value)
}
`,
      'src/cache.js': `/** No caching yet. */
export const cache = new Map()
`,
      'src/service.js': `import { read, write } from './source.js'

/** Look up a key. */
export function lookup(key) {
  return read(key)
}

/** Save a key. */
export function save(key, value) {
  write(key, value)
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { lookup, save } from './src/service.js'
import { readCount, resetReads } from './src/source.js'

resetReads()
assert.equal(lookup('a'), 1)
assert.equal(lookup('a'), 1)
assert.equal(readCount(), 1, 'the second lookup must be served from the cache')

resetReads()
assert.equal(lookup('b'), 2)
assert.equal(readCount(), 1, 'a different key is a real read')

save('a', 10)
resetReads()
assert.equal(lookup('a'), 10, 'a written key returns the new value')
assert.equal(readCount(), 1, 'the written key was invalidated')

resetReads()
assert.equal(lookup('b'), 2)
assert.equal(readCount(), 0, 'writing a must not invalidate b')
console.log('ok')
`,
    },
    solution: {
      'src/cache.js': `const entries = new Map()

/** Read a cached value, or undefined when absent. */
export function get(key) {
  return entries.get(key)
}

/** Store a value. */
export function set(key, value) {
  entries.set(key, value)
}

/** Drop one key. */
export function invalidate(key) {
  entries.delete(key)
}
`,
      'src/service.js': `import { read, write } from './source.js'
import { get, invalidate, set } from './cache.js'

/** Look up a key. */
export function lookup(key) {
  const cached = get(key)
  if (cached !== undefined) return cached
  const value = read(key)
  set(key, value)
  return value
}

/** Save a key. */
export function save(key, value) {
  write(key, value)
  invalidate(key)
}
`,
    },
  },
  {
    manifest: task({
      id: 'multi-file-feature-05-structured-audit',
      category: 'multi-file-feature',
      prompt: 'Record every mutation through src/audit.js: `save` and `remove` in src/service.js must each append one entry with the operation, the key, and whether it changed anything. Do not change what those functions return.',
      allowedScope: ['src'],
      rationale: 'Removing an absent key changes nothing, so the entry must say so. An audit that records intent rather than effect fails that case.',
    }),
    files: {
      'src/store.js': `const data = new Map([['a', 1]])

/** Write a key, reporting whether the value changed. */
export function write(key, value) {
  const changed = data.get(key) !== value
  data.set(key, value)
  return changed
}

/** Delete a key, reporting whether it existed. */
export function drop(key) {
  return data.delete(key)
}
`,
      'src/audit.js': `/** Nothing is audited yet. */
export const entries = []
`,
      'src/service.js': `import { drop, write } from './store.js'

/** Save a key. */
export function save(key, value) {
  return write(key, value)
}

/** Remove a key. */
export function remove(key) {
  return drop(key)
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { remove, save } from './src/service.js'
import * as audit from './src/audit.js'

const read = () => (typeof audit.entries === 'function' ? audit.entries() : audit.entries)

assert.equal(save('a', 1), false, 'the return value is unchanged')
assert.equal(save('a', 2), true)
assert.equal(remove('zz'), false, 'removing an absent key returns false')
assert.equal(remove('a'), true)

const log = read()
assert.equal(log.length, 4, 'one entry per mutation')
assert.deepEqual(
  log.map((entry) => [entry.operation, entry.key, entry.changed]),
  [['save', 'a', false], ['save', 'a', true], ['remove', 'zz', false], ['remove', 'a', true]],
  'each entry records the effect, not the intent',
)
console.log('ok')
`,
    },
    solution: {
      'src/audit.js': `const log = []

/** Record one mutation. */
export function record(operation, key, changed) {
  log.push({ operation, key, changed })
}

/** Everything recorded so far. */
export const entries = log
`,
      'src/service.js': `import { drop, write } from './store.js'
import { record } from './audit.js'

/** Save a key. */
export function save(key, value) {
  const changed = write(key, value)
  record('save', key, changed)
  return changed
}

/** Remove a key. */
export function remove(key) {
  const changed = drop(key)
  record('remove', key, changed)
  return changed
}
`,
    },
  },
]
