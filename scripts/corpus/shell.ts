/**
 * Platform-shell-behavior tasks.
 *
 * Each fixture is written so the wrong fix — a literal swap that happens to
 * match the host — passes a naive check and fails the oracle. The oracle
 * compares against what the runtime reports for the current platform, so the
 * same task is meaningful on macOS and on Windows without being rewritten.
 * @module scripts/corpus/shell
 */
import { ORACLE_HEADER, task, type TaskSpec } from './types.ts'

export const SHELL: readonly TaskSpec[] = [
  {
    manifest: task({
      id: 'platform-shell-behavior-02-line-endings',
      category: 'platform-shell-behavior',
      prompt: 'splitLines in src/lines.js leaves a stray carriage return on files written on Windows. Make it split correctly for both line-ending conventions.',
      allowedScope: ['src'],
      rationale: 'Splitting on the platform separator is the wrong fix: a file with either convention can be read on either platform. The oracle feeds both.',
    }),
    files: {
      'src/lines.js': `/** Split text into lines. */
export function splitLines(text) {
  return text.split('\\n')
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { splitLines } from './src/lines.js'

assert.deepEqual(splitLines('a\\nb\\nc'), ['a', 'b', 'c'], 'unix endings')
assert.deepEqual(splitLines('a\\r\\nb\\r\\nc'), ['a', 'b', 'c'], 'windows endings')
assert.deepEqual(splitLines('a\\r\\nb\\nc'), ['a', 'b', 'c'], 'a mixed file')
assert.deepEqual(splitLines(''), [''], 'empty text')
assert.deepEqual(splitLines('a\\r\\n'), ['a', ''], 'a trailing newline still yields a final empty line')
console.log('ok')
`,
    },
    solution: {
      'src/lines.js': `/** Split text into lines. */
export function splitLines(text) {
  return text.split(/\\r?\\n/)
}
`,
    },
  },
  {
    manifest: task({
      id: 'platform-shell-behavior-03-path-comparison',
      category: 'platform-shell-behavior',
      prompt: 'samePath in src/compare.js compares raw strings, so it says two spellings of one path differ. Compare them the way this platform resolves paths.',
      allowedScope: ['src'],
      rationale: 'Normalization must come from the path module, not from hand-written separator replacement, so the answer stays correct where separators differ.',
    }),
    files: {
      'src/compare.js': `/** Whether two paths refer to the same location. */
export function samePath(left, right) {
  return left === right
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { samePath } from './src/compare.js'
import { join, sep } from 'node:path'

assert.equal(samePath(join('a', 'b'), join('a', 'b')), true, 'identical paths')
assert.equal(samePath('a' + sep + 'b', join('a', '.', 'b')), true, 'a redundant dot segment')
assert.equal(samePath(join('a', 'x', '..', 'b'), join('a', 'b')), true, 'a parent segment')
assert.equal(samePath('a' + sep + 'b' + sep, join('a', 'b')), true, 'a trailing separator')
assert.equal(samePath(join('a', 'b'), join('a', 'c')), false, 'genuinely different paths')
console.log('ok')
`,
    },
    solution: {
      'src/compare.js': `import { normalize, sep } from 'node:path'

/** Whether two paths refer to the same location. */
export function samePath(left, right) {
  const strip = (value) => {
    const normalized = normalize(value)
    return normalized.length > 1 && normalized.endsWith(sep) ? normalized.slice(0, -1) : normalized
  }
  return strip(left) === strip(right)
}
`,
    },
  },
  {
    manifest: task({
      id: 'platform-shell-behavior-04-executable-lookup',
      category: 'platform-shell-behavior',
      prompt: 'resolveCommand in src/command.js hardcodes a POSIX path separator when it searches PATH. Use whatever this platform actually uses to separate PATH entries.',
      allowedScope: ['src'],
      rationale: 'PATH is colon-separated on POSIX and semicolon-separated on Windows, so on macOS the wrong fix passes every behavior check. The oracle additionally requires the delimiter to come from the runtime.',
    }),
    files: {
      'src/command.js': `/** Split a PATH value into its entries. */
export function pathEntries(value) {
  return value.split(':').filter(Boolean)
}

/** Find the first directory in PATH that a predicate accepts. */
export function resolveCommand(value, exists) {
  return pathEntries(value).find(exists) ?? null
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { pathEntries, resolveCommand } from './src/command.js'
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
assert.doesNotMatch(source, /split\\(['"][:;]['"]\\)/, 'the delimiter must come from the runtime, not a literal')
console.log('ok')
`,
    },
    solution: {
      'src/command.js': `import { delimiter } from 'node:path'

/** Split a PATH value into its entries. */
export function pathEntries(value) {
  return value.split(delimiter).filter(Boolean)
}

/** Find the first directory in PATH that a predicate accepts. */
export function resolveCommand(value, exists) {
  return pathEntries(value).find(exists) ?? null
}
`,
    },
  },
  {
    manifest: task({
      id: 'platform-shell-behavior-05-argument-quoting',
      category: 'platform-shell-behavior',
      prompt: 'runTool in src/run.js builds a shell string, which breaks on paths containing spaces. Pass the arguments as a list instead, so no quoting is needed.',
      allowedScope: ['src'],
      rationale: 'Quoting rules differ per platform, so the correct answer is to stop building a shell string. The oracle runs a real child process with a spaced path.',
    }),
    files: {
      'src/run.js': `import { execSync } from 'node:child_process'

/** Run a tool with one argument. */
export function runTool(command, argument) {
  return execSync(command + ' ' + argument, { encoding: 'utf8' }).trim()
}
`,
      'verify.mjs': `${ORACLE_HEADER}import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readFileSync } from 'node:fs'
import { runTool } from './src/run.js'

const dir = join(process.cwd(), 'a directory with spaces')
mkdirSync(dir, { recursive: true })
const script = join(dir, 'echo.mjs')
writeFileSync(script, 'console.log(process.argv[2] ?? "")\\n')

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
`,
    },
    solution: {
      'src/run.js': `import { execFileSync } from 'node:child_process'

/** Run a tool with one argument or a list of arguments. */
export function runTool(command, argument) {
  const args = Array.isArray(argument) ? argument : [argument]
  return execFileSync(command, args, { encoding: 'utf8' }).trim()
}
`,
    },
  },
]
