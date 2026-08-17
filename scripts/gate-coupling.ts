/**
 * Executed release gate for the zero-upstream-diff invariant (ADR-0001).
 *
 * Rejects, across every tracked source file and manifest in this repository:
 * path-form dependencies on a Harness checkout, deep imports past a published
 * package's `exports`, copied upstream source, generated upstream CSS class
 * names, private DOM structure queries, postinstall patching, and runtime
 * monkey patches.
 *
 * Exits non-zero listing every violation with file, line, and rule. Run as
 * `pnpm run gate:coupling`.
 * @module scripts/gate-coupling
 */
import { readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { dirname, extname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** One rejected coupling form. */
interface Rule {
  /** Stable rule id reported with each violation. */
  readonly id: string
  /** What the rule protects, phrased as the reason the match is rejected. */
  readonly reason: string
  /** Matches a violating line. */
  readonly pattern: RegExp
  /** Restrict the rule to these file extensions; every file when omitted. */
  readonly extensions?: readonly string[]
  /**
   * Restrict the rule to files under these path prefixes; every file when omitted.
   *
   * Used for rules that are about *where* a dependency appears rather than
   * whether it exists at all: the desktop bridge is legitimate in the desktop
   * packages and forbidden in the Harness-facing ones.
   */
  readonly paths?: readonly string[]
  /**
   * Skip files under these path prefixes.
   *
   * For a rule that must skip one specific module rather than a whole class of
   * files; prefer {@link Rule.productSourceOnly} when the exception is "tests".
   */
  readonly excludePaths?: readonly string[]
  /**
   * Scan product source only, skipping tests and documentation.
   *
   * Rules phrased as "this repository must never contain X" have to exempt both
   * the tests that assert X is refused and the prose that explains the refusal:
   * each must spell X out, and flagging them makes the rule punish its own
   * enforcement.
   */
  readonly productSourceOnly?: boolean
}

/**
 * Whether a repository path is something other than product source.
 *
 * Tests and prose both have to name the thing a rule forbids — a test to assert
 * it is refused, documentation to explain that it is. Flagging either makes a
 * rule punish its own enforcement, which happened three times with tests and
 * once with the README before this was stated as a category.
 * @param path - Repository-relative path.
 * @returns True for a test or documentation file.
 */
function isNonProductPath(path: string): boolean {
  return path.includes('/tests/')
    || path.includes('/__tests__/')
    || /\.(test|spec)\.[cm]?[jt]sx?$/.test(path)
    || path.endsWith('.md')
}

/**
 * Whether an upstream specifier names a subpath the package actually exports.
 *
 * Read from the installed package's own `exports` map rather than compared to a
 * hardcoded list: a fixed list cannot distinguish a genuine deep import from a
 * documented subpath the list has not heard of yet, and it fails in the
 * dangerous direction — a maintainer whose legitimate import is rejected is
 * pushed toward widening the rule.
 *
 * An unresolvable package is treated as *not* exporting the subpath, so a typo
 * or an uninstalled dependency still fails.
 * Resolution walks up from the importing file, because pnpm installs a
 * package's own devDependencies under that package rather than at the root.
 * @param specifier - The import specifier, e.g. `@deepseek-ai/dsh-x/client`.
 * @param fromFile - Repository-relative path of the importing file.
 * @returns True when the package declares that subpath.
 */
function isDocumentedSubpath(specifier: string, fromFile: string): boolean {
  const segments = specifier.split('/')
  const packageName = segments.slice(0, 2).join('/')
  const subpath = segments.length > 2 ? `./${segments.slice(2).join('/')}` : '.'
  if (subpath === './package.json') return true
  let manifest: { exports?: unknown } | undefined
  // `..` from a module URL keeps a trailing separator; comparing against it
  // directly stops the walk one level before the repository root itself.
  const root = resolve(REPOSITORY_ROOT)
  for (
    let directory = dirname(resolve(root, fromFile));
    directory === root || directory.startsWith(`${root}/`);
    directory = dirname(directory)
  ) {
    try {
      manifest = JSON.parse(
        readFileSync(join(directory, 'node_modules', packageName, 'package.json'), 'utf8'),
      ) as { exports?: unknown }
      break
    } catch {
      // Not installed at this level; keep walking toward the root.
    }
  }
  // Unresolvable: not proof of a documented export, so it stays a finding.
  if (manifest === undefined) return false
  const exportsField = manifest.exports
  if (exportsField === null || typeof exportsField !== 'object') return false
  const keys = Object.keys(exportsField)
  return keys.some((key) => key === subpath
    || (key.endsWith('/*') && subpath.startsWith(key.slice(0, -1))))
}

const RULES: readonly Rule[] = [
  {
    id: 'workbench-over-ipc',
    reason: 'workbench data must travel the official HTTP Remote; routing it through the desktop bridge would make the browser build a second-class one and put Harness business calls on Electron IPC',
    pattern: /from\s+['"]@dsh-desktop\/desktop-contract['"]|window\.__DESKTOP_BRIDGE__|desktopBridge|invokeDesktop/,
    extensions: ['.ts', '.tsx'],
    paths: ['packages/daily-workbench/', 'packages/daily-agent/', 'packages/plugin-governance/'],
    productSourceOnly: true,
  },
  {
    id: 'workspace-dependency',
    reason: 'a workspace:/link:/file:/path dependency would bind this repository to a Harness checkout instead of a published release',
    pattern: /"@deepseek-ai\/[^"]+"\s*:\s*"(workspace:|link:|file:|portal:|\.{1,2}\/|\/)/,
    extensions: ['.json'],
  },
  {
    id: 'upstream-checkout-path',
    reason: 'a literal path into a Harness source checkout resolves product code outside this repository',
    // The negative lookbehind separates a source checkout from the Harness
    // home: `../dsh/packages/` is a checkout, `~/.dsh/packages/` is the
    // installed runtime this product legitimately reads.
    pattern: /(?<![.\w-])(?:deepseek-harness|dsh)\/(?:packages|apps|vendor)\//,
  },
  {
    id: 'deep-import',
    reason: 'importing past a published package export couples this repository to upstream internals',
    pattern: /from\s+['"]@deepseek-ai\/[^'"]*\/(?:src|lib|dist|internal)\//,
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
  },
  {
    id: 'postinstall-patch',
    reason: 'patching an installed dependency creates an undeclared fork',
    pattern: /"(?:postinstall|prepare)"\s*:\s*"[^"]*(?:patch-package|patch\s|apply.*\.patch)/,
    extensions: ['.json'],
  },
  {
    id: 'generated-css-selector',
    reason: 'a generated upstream class name is not a public contract and breaks on any upstream rebuild',
    pattern: /['"`][.#][A-Za-z0-9_-]*[0-9a-f]{6,}_[A-Za-z0-9_-]+['"`]/,
    extensions: ['.ts', '.tsx', '.css'],
  },
  {
    id: 'private-dom-query',
    reason: 'querying upstream DOM structure substitutes a private layout detail for a public slot',
    pattern: /document\.(?:querySelector(?:All)?|getElementsBy(?:ClassName|TagName))\s*\(\s*['"`][^'"`]*(?:ds-|dsh-|_[0-9a-f]{6,})/,
    extensions: ['.ts', '.tsx'],
  },
  {
    id: 'copied-preset-composition',
    reason: 'a copied official preset composition turns every upstream addition into manual synchronization; '
      + 'daily mode decorates the live Standard preset instead',
    pattern: /agent-presets\/(?:standard|minimal|code|cordis)\/agent\.cordis\.yml|['"`]@deepseek-ai\/dsh-persona['"`]/,
    extensions: ['.yml', '.yaml', '.ts'],
  },
  {
    id: 'second-plugin-installer',
    reason: 'the official profile package manager is the only installation path; a second manifest, '
      + 'cache, or installer duplicates supply-chain and upgrade work',
    pattern: /\.dsh-plugin\b/,
    // The module whose job is to refuse these forms has to name them.
    excludePaths: ['packages/plugin-governance/src/lifecycle.ts'],
    productSourceOnly: true,
  },
  {
    id: 'monkey-patch',
    reason: 'reassigning an upstream global or prototype member is a runtime patch',
    pattern: /\b(?:window|globalThis)\.__(?:DSH|ModuleLoader)__[A-Za-z_]*\s*=(?!=)/,
    extensions: ['.ts', '.tsx', '.js'],
  },
]

/** Files whose own text defines the forbidden forms and must not match themselves. */
const SELF_EXEMPT = new Set(['scripts/gate-coupling.ts'])

/**
 * Report every prohibited-coupling match in the tracked tree.
 * @returns One entry per violating line.
 */
function findViolations(): string[] {
  // Tracked plus not-yet-committed files, excluding anything gitignored: the
  // gate must hold on a working tree, not only after a commit.
  const tracked = execFileSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard'],
    { cwd: REPOSITORY_ROOT, encoding: 'utf8' },
  )
    .split('\n')
    .filter((path) => path.length > 0)
  const violations: string[] = []
  for (const path of tracked) {
    if (SELF_EXEMPT.has(path)) continue
    if (path.startsWith('openspec/') || path.startsWith('docs/')) continue
    const extension = extname(path)
    let text: string
    try {
      text = readFileSync(new URL(path, `file://${REPOSITORY_ROOT}`), 'utf8')
    } catch {
      // Unreadable tracked entry (submodule gitlink or symlink target outside the
      // tree); nothing to scan and no other reader depends on it here.
      continue
    }
    const lines = text.split('\n')
    for (const rule of RULES) {
      if (rule.extensions !== undefined && !rule.extensions.includes(extension)) continue
      if (rule.paths !== undefined && !rule.paths.some((prefix) => path.startsWith(prefix))) continue
      if (rule.excludePaths?.some((prefix) => path.startsWith(prefix)) === true) continue
      if (rule.productSourceOnly === true && isNonProductPath(path)) continue
      lines.forEach((line, index) => {
        if (rule.pattern.test(line)) {
          violations.push(`${path}:${index + 1}  [${rule.id}] ${rule.reason}\n    ${line.trim()}`)
        }
      })
    }
    if (extension === '.ts' || extension === '.tsx') {
      violations.push(...findDeepSubpathImports(path, lines))
    }
  }
  return violations
}

/**
 * Reject `@deepseek-ai/*` imports whose subpath is not a documented export.
 * @param path - Repository-relative file path used in the violation message.
 * @param lines - The file's lines, already split.
 * @returns One entry per undocumented subpath import.
 */
function findDeepSubpathImports(path: string, lines: readonly string[]): string[] {
  const found: string[] = []
  const specifier = /from\s+['"](@deepseek-ai\/[^'"]+)['"]/g
  lines.forEach((line, index) => {
    for (const match of line.matchAll(specifier)) {
      const value = match[1]
      if (value === undefined) continue
      if (isDocumentedSubpath(value, path)) continue
      found.push(
        `${path}:${index + 1}  [deep-import] "${value}" is not a documented subpath export`
        + `\n    ${line.trim()}`,
      )
    }
  })
  return found
}

const violations = findViolations()
if (violations.length > 0) {
  console.error(`gate:coupling — ${violations.length} prohibited upstream coupling(s):\n`)
  for (const violation of violations) console.error(`${violation}\n`)
  process.exit(1)
}
console.log('gate:coupling — no prohibited upstream coupling found')
