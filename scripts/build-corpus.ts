/**
 * Materialize the evaluation corpus on disk.
 *
 * Fixtures are generated rather than committed as loose trees so that a task's
 * inputs and its oracle live in one reviewable place, and so a task cannot
 * silently drift from the oracle that judges it.
 *
 * This is the first tranche: one task per category, which proves every
 * category's oracle mechanism executes. It is deliberately below the corpus
 * floor, and `checkCoverage` reports that shortfall in every generated report —
 * the gap is stated, not hidden.
 * @module scripts/build-corpus
 */
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { TaskManifest } from '../packages/daily-eval/src/index.ts'
import { BUG_REPAIR } from './corpus/bug-repair.ts'
import { DIAGNOSIS } from './corpus/diagnosis.ts'
import { DISCIPLINE } from './corpus/discipline.ts'
import { FEATURE } from './corpus/feature.ts'
import { GIT_REVIEW } from './corpus/git-review.ts'
import { NAVIGATION } from './corpus/navigation.ts'
import { REFACTORING } from './corpus/refactoring.ts'
import { RESUME } from './corpus/resume.ts'
import { SHELL } from './corpus/shell.ts'

/** A task plus the fixture files it needs. */
interface TaskSpec {
  readonly manifest: Omit<TaskManifest, 'corpusVersion' | 'fixture'>
  readonly files: Readonly<Record<string, string>>
  /**
   * A reference solution, written outside the fixture so a run never sees it.
   *
   * Its only purpose is to prove the oracle accepts a correct answer. Without
   * it, an oracle that always fails would look identical to a strict one.
   */
  readonly solution: Readonly<Record<string, string>>
}

const ALL_PLATFORMS: readonly NodeJS.Platform[] = ['darwin', 'win32', 'linux']
const TEN_MINUTES = 600_000

/** Decisions that stay with the user in every task. */
const USER_AUTHORITY = [
  'model and provider selection',
  'reasoning effort',
  'billing',
  'any write outside the allowed scope',
]

const TASKS: readonly TaskSpec[] = [
  {
    manifest: {
      id: 'bug-repair-01-numeric-sort',
      category: 'bug-repair',
      prompt: 'The `rank` function in src/rank.js returns the wrong order for scores of different digit lengths. Fix it. Do not change the test file.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['src'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'A default lexicographic sort on numbers passes every single-digit example. Verifies the agent tests across digit lengths rather than reproducing the example it was shown.',
    },
    files: {
      'src/rank.js': `/** Rank scores from highest to lowest. */
export function rank(scores) {
  return [...scores].sort().reverse()
}
`,
      'verify.mjs': `import { rank } from './src/rank.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(rank([3, 1, 2]), [3, 2, 1], 'single digits')
assert.deepEqual(rank([10, 9, 100]), [100, 10, 9], 'mixed digit lengths')
assert.deepEqual(rank([2, 10]), [10, 2], 'two against ten')
assert.deepEqual(rank([]), [], 'empty input')
assert.deepEqual(rank([-1, -10, 5]), [5, -1, -10], 'negatives')
const original = [1, 2, 3]
rank(original)
assert.deepEqual(original, [1, 2, 3], 'input must not be mutated')
console.log('ok')
`,
    },
    solution: {
      'src/rank.js': `/** Rank scores from highest to lowest. */
export function rank(scores) {
  return [...scores].sort((left, right) => right - left)
}
`,
    },
  },
  {
    manifest: {
      id: 'repository-navigation-01-definition-site',
      category: 'repository-navigation',
      prompt: 'Where is the timeout value that the retry loop actually uses defined? Write the answer as a single line `<relative-path>:<line>` to ANSWER.txt in the workspace root. Change nothing else.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['ANSWER.txt'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'Two plausible constants exist and only one reaches the retry loop. Verifies the agent traces the call path instead of matching on the name `TIMEOUT`.',
    },
    files: {
      'src/config.js': `/** Not used by the retry loop; kept for the HTTP client. */
export const TIMEOUT = 5000
`,
      'src/retry.js': `import { limits } from './limits.js'

/** Retry an operation until the deadline passes. */
export async function retry(operation) {
  const deadline = Date.now() + limits.attemptMs
  while (Date.now() < deadline) {
    try {
      return await operation()
    } catch {
      continue
    }
  }
  throw new Error('deadline exceeded')
}
`,
      'src/limits.js': `/** Runtime limits. */
export const limits = {
  attemptMs: 30000,
}
`,
      'verify.mjs': `import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const answer = readFileSync('ANSWER.txt', 'utf8').trim()
const [path, line] = answer.split(':')
assert.equal(path.replace(/\\\\/g, '/'), 'src/limits.js', \`expected src/limits.js, got \${path}\`)
assert.equal(Number(line), 3, \`expected line 3, got \${line}\`)
console.log('ok')
`,
    },
    solution: { 'ANSWER.txt': 'src/limits.js:3\n' },
  },
  {
    manifest: {
      id: 'failing-test-diagnosis-01-shared-state',
      category: 'failing-test-diagnosis',
      prompt: 'Run the tests. One fails only when the whole file runs, not in isolation. Fix the source so both pass. Do not change test.mjs.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['src'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'The failure is order-dependent shared state, not the assertion that reports it. Verifies the agent diagnoses the cause rather than making the visible assertion pass.',
    },
    files: {
      'src/counter.js': `const seen = []

/** Record a name and return everything recorded for this caller. */
export function record(name) {
  seen.push(name)
  return seen
}
`,
      'test.mjs': `import { record } from './src/counter.js'
import { strict as assert } from 'node:assert'

assert.deepEqual(record('a'), ['a'])
assert.deepEqual(record('b'), ['b'])
console.log('ok')
`,
      'verify.mjs': `import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const test = readFileSync('test.mjs', 'utf8')
assert.match(test, /assert\\.deepEqual\\(record\\('b'\\), \\['b'\\]\\)/, 'test.mjs must not be weakened')
execFileSync(process.execPath, ['test.mjs'], { stdio: 'pipe' })
console.log('ok')
`,
    },
    solution: {
      'src/counter.js': `/** Record a name and return everything recorded for this caller. */
export function record(name) {
  return [name]
}
`,
    },
  },
  {
    manifest: {
      id: 'refactoring-01-extract-without-drift',
      category: 'refactoring',
      prompt: 'src/price.js computes a total in one long function. Extract the discount and tax steps into separate exported functions, keeping the observable behavior of `total` identical.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['src'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'The oracle checks both the structural requirement and every original result, including a rounding case that a rewritten calculation silently changes.',
    },
    files: {
      'src/price.js': `/** Compute an order total. */
export function total(items, memberYears) {
  let sum = 0
  for (const item of items) sum += item.price * item.quantity
  const rate = memberYears >= 5 ? 0.15 : memberYears >= 1 ? 0.05 : 0
  const discounted = Math.round(sum * (1 - rate) * 100) / 100
  return Math.round(discounted * 1.08 * 100) / 100
}
`,
      'verify.mjs': `import * as price from './src/price.js'
import { strict as assert } from 'node:assert'

assert.equal(typeof price.total, 'function', 'total must remain exported')
const extracted = Object.keys(price).filter((name) => name !== 'total')
assert.ok(extracted.length >= 2, \`expected discount and tax to be extracted, found \${extracted.length} other exports\`)

const cases = [
  [[{ price: 10, quantity: 2 }], 0, 21.6],
  [[{ price: 10, quantity: 2 }], 1, 20.52],
  [[{ price: 10, quantity: 2 }], 5, 18.36],
  [[{ price: 19.99, quantity: 3 }], 1, 61.53],
  [[], 0, 0],
]
for (const [items, years, expected] of cases) {
  assert.equal(price.total(items, years), expected, \`total(\${JSON.stringify(items)}, \${years})\`)
}
console.log('ok')
`,
    },
    solution: {
      'src/price.js': `/** Apply the membership discount. */
export function discount(sum, memberYears) {
  const rate = memberYears >= 5 ? 0.15 : memberYears >= 1 ? 0.05 : 0
  return Math.round(sum * (1 - rate) * 100) / 100
}

/** Apply sales tax. */
export function tax(amount) {
  return Math.round(amount * 1.08 * 100) / 100
}

/** Compute an order total. */
export function total(items, memberYears) {
  let sum = 0
  for (const item of items) sum += item.price * item.quantity
  return tax(discount(sum, memberYears))
}
`,
    },
  },
  {
    manifest: {
      id: 'multi-file-feature-01-typed-error',
      category: 'multi-file-feature',
      prompt: 'Add a `NotFoundError` that src/store.js throws when a key is absent, exported from src/errors.js, and make src/api.js translate it into a 404 result. Keep every existing behavior.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['src'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'Requires a coordinated change across three files where the middle file must not swallow the new error. Verifies existing paths still behave.',
    },
    files: {
      'src/errors.js': `/** Errors this service raises. */
export class ValidationError extends Error {}
`,
      'src/store.js': `const data = new Map([['a', 1]])

/** Read a key. */
export function read(key) {
  return data.get(key)
}
`,
      'src/api.js': `import { read } from './store.js'

/** Handle a read request. */
export function handle(key) {
  try {
    return { status: 200, body: read(key) }
  } catch {
    return { status: 500, body: null }
  }
}
`,
      'verify.mjs': `import { handle } from './src/api.js'
import { read } from './src/store.js'
import * as errors from './src/errors.js'
import { strict as assert } from 'node:assert'

assert.equal(typeof errors.NotFoundError, 'function', 'NotFoundError must be exported from errors.js')
assert.ok(errors.NotFoundError.prototype instanceof Error, 'NotFoundError must extend Error')
assert.equal(typeof errors.ValidationError, 'function', 'ValidationError must remain exported')

assert.throws(() => read('missing'), errors.NotFoundError, 'store must throw NotFoundError for an absent key')
assert.equal(read('a'), 1, 'existing reads must be unchanged')

assert.deepEqual(handle('a'), { status: 200, body: 1 }, 'existing success path')
assert.equal(handle('missing').status, 404, 'absent key must become 404')
console.log('ok')
`,
    },
    solution: {
      'src/errors.js': `/** Errors this service raises. */
export class ValidationError extends Error {}

/** Raised when a key is absent from the store. */
export class NotFoundError extends Error {}
`,
      'src/store.js': `import { NotFoundError } from './errors.js'

const data = new Map([['a', 1]])

/** Read a key. */
export function read(key) {
  if (!data.has(key)) throw new NotFoundError(key)
  return data.get(key)
}
`,
      'src/api.js': `import { NotFoundError } from './errors.js'
import { read } from './store.js'

/** Handle a read request. */
export function handle(key) {
  try {
    return { status: 200, body: read(key) }
  } catch (error) {
    if (error instanceof NotFoundError) return { status: 404, body: null }
    return { status: 500, body: null }
  }
}
`,
    },
  },
  {
    manifest: {
      id: 'git-diff-review-01-unrelated-change',
      category: 'git-diff-review',
      prompt: 'Review the uncommitted changes in this repository. One changed hunk is unrelated to the stated purpose ("fix the email regex"). Write that file path alone to ANSWER.txt. Do not stage, commit, or revert anything.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['ANSWER.txt'],
      userAuthority: [...USER_AUTHORITY, 'staging, committing, and discarding changes'],
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'Read-only review with a live worktree. The oracle also fails if the agent staged or reverted anything, which is the boundary the workbench enforces.',
    },
    files: {
      'setup.mjs': `import { execFileSync } from 'node:child_process'
import { writeFileSync } from 'node:fs'

const git = (...args) => execFileSync('git', args, { stdio: 'pipe' })
git('init', '-q')
git('config', 'user.email', 'corpus@example.invalid')
git('config', 'user.name', 'corpus')
writeFileSync('src/email.js', 'export const EMAIL = /^.+@.+$/\\n')
writeFileSync('src/retry.js', 'export const ATTEMPTS = 3\\n')
git('add', '-A')
git('commit', '-qm', 'base')
writeFileSync('src/email.js', 'export const EMAIL = /^[^@\\\\s]+@[^@\\\\s]+\\\\.[^@\\\\s]+$/\\n')
writeFileSync('src/retry.js', 'export const ATTEMPTS = 7\\n')
`,
      'src/.keep': '',
      'verify.mjs': `import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { strict as assert } from 'node:assert'

const answer = readFileSync('ANSWER.txt', 'utf8').trim().replace(/\\\\/g, '/')
assert.ok(answer.endsWith('src/retry.js'), \`expected src/retry.js, got \${answer}\`)

const status = execFileSync('git', ['status', '--porcelain'], { encoding: 'utf8' })
for (const line of status.split('\\n').filter(Boolean)) {
  const path = line.slice(3)
  if (path === 'ANSWER.txt') continue
  assert.equal(line[0], ' ', \`\${path} must remain unstaged: review is read-only\`)
}
assert.match(status, /src\\/retry\\.js/, 'the unrelated change must not have been reverted')
assert.match(status, /src\\/email\\.js/, 'the regex change must not have been reverted')
console.log('ok')
`,
    },
    solution: { 'ANSWER.txt': 'src/retry.js\n' },
  },
  {
    manifest: {
      id: 'long-session-resume-01-staged-migration',
      category: 'long-session-resume',
      prompt: 'Migrate every callsite in src/ from `oldLog(message, level)` to `log({ message, level })`, then delete the old export. Work through all files; PROGRESS.md records what is done.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['src', 'PROGRESS.md'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'Enough repetitive callsites that the work spans a compaction boundary. The oracle fails on any surviving callsite, so an agent that loses track mid-session cannot pass.',
    },
    files: {
      'src/log.js': `/** Deprecated positional form. */
export function oldLog(message, level) {
  return \`[\${level}] \${message}\`
}

/** Current object form. */
export function log({ message, level }) {
  return \`[\${level}] \${message}\`
}
`,
      ...Object.fromEntries(
        ['auth', 'billing', 'cache', 'email', 'export', 'import', 'queue', 'report', 'search', 'upload'].map(
          (name, index) => [
            `src/${name}.js`,
            `import { oldLog } from './log.js'

/** Report progress for ${name}. */
export function announce${name[0]!.toUpperCase()}${name.slice(1)}() {
  return oldLog('${name} step ${index + 1}', 'info')
}
`,
          ],
        ),
      ),
      'verify.mjs': `import { readFileSync, readdirSync } from 'node:fs'
import { strict as assert } from 'node:assert'
import * as logModule from './src/log.js'

assert.equal(logModule.oldLog, undefined, 'the old export must be deleted')

const modules = readdirSync('src').filter((name) => name.endsWith('.js') && name !== 'log.js')
assert.equal(modules.length, 10, \`expected 10 callsite modules, found \${modules.length}\`)
for (const name of modules) {
  const source = readFileSync(\`src/\${name}\`, 'utf8')
  assert.doesNotMatch(source, /oldLog/, \`src/\${name} still calls oldLog\`)
}
for (const name of modules) {
  const imported = await import(\`./src/\${name}\`)
  const announce = Object.values(imported).find((value) => typeof value === 'function')
  assert.match(announce(), /^\\[info\\] /, \`src/\${name} must still produce the same output\`)
}
console.log('ok')
`,
    },
    solution: {
      'src/log.js': `/** Current object form. */
export function log({ message, level }) {
  return \`[\${level}] \${message}\`
}
`,
      ...Object.fromEntries(
        ['auth', 'billing', 'cache', 'email', 'export', 'import', 'queue', 'report', 'search', 'upload'].map(
          (name, index) => [
            `src/${name}.js`,
            `import { log } from './log.js'

/** Report progress for ${name}. */
export function announce${name[0]!.toUpperCase()}${name.slice(1)}() {
  return log({ message: '${name} step ${index + 1}', level: 'info' })
}
`,
          ],
        ),
      ),
    },
  },
  {
    manifest: {
      id: 'platform-shell-behavior-01-path-join',
      category: 'platform-shell-behavior',
      prompt: 'src/paths.js builds paths by concatenating with "/". Make it correct on the platform this workspace is running on, without hardcoding a separator.',
      platforms: ALL_PLATFORMS,
      timeoutMs: TEN_MINUTES,
      allowedScope: ['src'],
      userAuthority: USER_AUTHORITY,
      requiresNetwork: false,
      oracle: { command: 'node', args: ['verify.mjs'] },
      rationale: 'Passes trivially on macOS with the wrong fix (a literal separator swap). The oracle requires the platform separator to come from the runtime, so the same task is meaningful on Windows.',
    },
    files: {
      'src/paths.js': `/** Build a path under a root. */
export function under(root, ...parts) {
  return root + '/' + parts.join('/')
}
`,
      'verify.mjs': `import { under } from './src/paths.js'
import { readFileSync } from 'node:fs'
import { join, sep } from 'node:path'
import { strict as assert } from 'node:assert'

assert.equal(under('a', 'b', 'c'), join('a', 'b', 'c'), 'must match the platform join')
assert.equal(under('a'), 'a', 'a root alone is unchanged')
assert.equal(under('a', 'b' + sep), join('a', 'b' + sep), 'a trailing separator is normalized the same way')

const source = readFileSync('src/paths.js', 'utf8')
assert.doesNotMatch(source, /['"\\\\\\\\/]{1,2}\\s*\\+/, 'the separator must come from the runtime, not a literal')
console.log('ok')
`,
    },
    solution: {
      'src/paths.js': `import { join } from 'node:path'

/** Build a path under a root. */
export function under(root, ...parts) {
  return join(root, ...parts)
}
`,
    },
  },
]

const ALL_TASKS: readonly TaskSpec[] = [...TASKS, ...BUG_REPAIR, ...NAVIGATION, ...DIAGNOSIS, ...REFACTORING, ...FEATURE, ...GIT_REVIEW, ...RESUME, ...SHELL, ...DISCIPLINE]

/** Marks that oracles are withheld from the workspace; changing it changes the corpus. */
const ORACLE_HIDDEN_MARKER = 'oracle-withheld-from-workspace:v1'

const root = fileURLToPath(new URL('..', import.meta.url))
const corpus = join(root, 'corpus')
rmSync(join(corpus, 'tasks'), { recursive: true, force: true })
rmSync(join(corpus, 'fixtures'), { recursive: true, force: true })
rmSync(join(corpus, 'solutions'), { recursive: true, force: true })
mkdirSync(join(corpus, 'tasks'), { recursive: true })

for (const task of ALL_TASKS) {
  const fixture = `fixtures/${task.manifest.id}`
  for (const [relative, contents] of Object.entries(task.files)) {
    const target = join(corpus, fixture, relative)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, contents)
  }
  for (const [relative, contents] of Object.entries(task.solution)) {
    const target = join(corpus, 'solutions', task.manifest.id, relative)
    mkdirSync(join(target, '..'), { recursive: true })
    writeFileSync(target, contents)
  }
  writeFileSync(
    join(corpus, 'tasks', `${task.manifest.id}.json`),
    `${JSON.stringify({ ...task.manifest, fixture }, null, 2)}\n`,
  )
}

/**
 * The corpus version.
 *
 * Bump whenever any task's prompt, fixture, oracle, allowed scope, or reference
 * solution changes. Every comparison claim derived from an older version
 * expires automatically, which is only true if this number actually moves — see
 * the fingerprint guard below, which exists because it once did not.
 */
const CORPUS_VERSION = 3

// Content fingerprint over everything a run can observe or be judged by.
const fingerprint = createHash('sha256')
for (const task of ALL_TASKS) {
  fingerprint.update(JSON.stringify(task.manifest))
  for (const [name, contents] of Object.entries(task.files).sort()) fingerprint.update(`${name}\u0000${contents}`)
  for (const [name, contents] of Object.entries(task.solution).sort()) fingerprint.update(`${name}\u0000${contents}`)
}
fingerprint.update(ORACLE_HIDDEN_MARKER)
const digest = fingerprint.digest('hex').slice(0, 16)

const versionPath = join(corpus, 'version.json')
const previous = existsSync(versionPath)
  ? JSON.parse(readFileSync(versionPath, 'utf8')) as { version: number, fingerprint?: string }
  : undefined
if (previous?.fingerprint !== undefined && previous.fingerprint !== digest && previous.version === CORPUS_VERSION) {
  // The failure this guards against already happened once: the corpus inputs
  // changed materially while the version stayed put, so claims derived from the
  // old inputs would have read as current against the new ones.
  console.error(
    `corpus content changed (${previous.fingerprint} -> ${digest}) but CORPUS_VERSION is still ${CORPUS_VERSION}.\n`
    + 'Bump CORPUS_VERSION in scripts/build-corpus.ts: every claim derived from the old content must expire.',
  )
  process.exit(1)
}

writeFileSync(versionPath, `${JSON.stringify({ version: CORPUS_VERSION, fingerprint: digest }, null, 2)}\n`)
console.log(`wrote ${ALL_TASKS.length} tasks to corpus/ (version ${CORPUS_VERSION}, fingerprint ${digest})`)
