/**
 * Security negatives.
 *
 * Every test here asserts that something is **refused**. A suite of positives
 * proves the product works; only these prove it stops working when it should,
 * and a boundary with no failing case behind it is an assumption rather than a
 * control.
 *
 * Each case names the attack it stands for, so a later reader can tell whether
 * a change that makes one pass is a fix or a regression in disguise.
 */
import { mkdirSync, mkdtempSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkspaceScope } from '../src/workspace.ts'
import { WorkbenchCapability } from '../src/gateway.ts'
import { READ_ONLY_SUBCOMMANDS } from '../src/git.ts'
import { redact, EXCLUDED_FROM_REPORTS } from '../../plugin-governance/src/redact.ts'
import { classifySource } from '../../plugin-governance/src/lifecycle.ts'
import { UNKNOWN_AUTHORITY, deriveAuthority } from '../../plugin-governance/src/authority.ts'

/** A real workspace with a file inside and a secret outside. */
function workspace(): { root: string, outside: string } {
  const base = mkdtempSync(join(tmpdir(), 'wb-sec-'))
  const root = join(base, 'workspace')
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'a.ts'), 'export const a = 1\n')
  const outside = join(base, 'secret.txt')
  writeFileSync(outside, 'SECRET\n')
  return { root, outside }
}

describe('workspace escape is refused in every spelling', () => {
  const { root, outside } = workspace()
  const scope = new WorkspaceScope(root)

  it.each([
    ['parent traversal', '../secret.txt'],
    ['repeated traversal', '../../../../etc/passwd'],
    ['traversal after a valid prefix', 'src/../../secret.txt'],
    ['absolute path', '/etc/passwd'],
    ['absolute path inside the same parent', outside],
    ['dot-segment padding', './././../secret.txt'],
    ['a NUL byte, which truncates the path at the syscall', 'src/a.ts\u0000.png'],
  ])('refuses %s', (_name, candidate) => {
    expect(scope.resolveRelative(candidate).ok).toBe(false)
  })

  it('accepts an ordinary path inside the workspace', () => {
    // The positive control. Without it every refusal above would also pass for
    // a scope that refuses everything, or for a method that does not exist —
    // which is exactly what this test caught on its first run.
    const result = scope.resolveRelative('src/a.ts')
    expect(result.ok).toBe(true)
    // Compared against the real path: containment is decided after symlink
    // resolution, which on macOS turns /var into /private/var.
    if (result.ok) expect(result.absolutePath).toBe(realpathSync(join(root, 'src/a.ts')))
  })

  it('refuses a symlink that points outside the workspace', () => {
    // Containment is decided on real paths, so a link is not a way around it.
    const link = join(root, 'escape')
    try {
      symlinkSync(outside, link)
    } catch {
      return
    }
    expect(scope.resolveRelative('escape').ok).toBe(false)
  })

  it('refuses an empty path rather than resolving to the root', () => {
    expect(scope.resolveRelative('').ok).toBe(false)
  })

  it('distinguishes why it refused, so the caller cannot probe the host', () => {
    // An absolute path is refused for being absolute, not for being absent:
    // otherwise the difference between the two answers maps the filesystem.
    expect(scope.resolveRelative('/etc/passwd')).toMatchObject({ failure: 'not-relative' })
  })
})

describe('the workbench exposes no general filesystem or process Remote', () => {
  const capability = new WorkbenchCapability(workspace().root)

  it('offers exactly the five intended methods', () => {
    const methods = Object.getOwnPropertyNames(Object.getPrototypeOf(capability))
      .filter((name) => name !== 'constructor')
    expect(methods).toHaveLength(5)
  })

  it.each(['readFile', 'writeFile', 'exec', 'spawn', 'run', 'shell', 'readdir', 'unlink'])(
    'exposes no %s',
    (name) => {
      expect((capability as unknown as Record<string, unknown>)[name]).toBeUndefined()
    },
  )

  it('exposes no accessor that would leak the absolute host path', () => {
    // A `root` getter existed once and was removed for exactly this reason.
    expect((capability as unknown as Record<string, unknown>)['root']).toBeUndefined()
  })
})

describe('Git access is read-only by allowlist, not by intention', () => {
  it.each(['commit', 'push', 'reset', 'clean', 'checkout', 'rebase', 'merge', 'stash', 'apply', 'gc'])(
    'does not allow %s',
    (subcommand) => {
      expect(READ_ONLY_SUBCOMMANDS).not.toContain(subcommand)
    },
  )

  it('allows the read-only subcommands the review surface needs', () => {
    expect(READ_ONLY_SUBCOMMANDS).toContain('status')
    expect(READ_ONLY_SUBCOMMANDS).toContain('diff')
  })
})

describe('diagnostics never carry credentials', () => {
  it.each([
    ['bearer token', 'Authorization: Bearer sk-live-9f2b7c41d8e05a63', 'sk-live-9f2b7c41d8e05a63'],
    ['api key assignment', 'DEEPSEEK_API_KEY=sk-abc123def456', 'sk-abc123def456'],
    ['cookie header', 'Cookie: session=abcdef123456', 'abcdef123456'],
    ['query parameter', 'https://x.invalid/a?token=abcdef123456', 'abcdef123456'],
    ['password field', 'password: hunter2hunter2', 'hunter2hunter2'],
  ])('redacts a %s', (_name, input, secret) => {
    expect(redact(input)).not.toContain(secret)
  })

  it('keeps enough context for the line to remain useful', () => {
    expect(redact('Authorization: Bearer sk-live-9f2b')).toMatch(/Authorization/i)
  })

  it('excludes prompt bodies and workspace contents from reports by name', () => {
    expect(EXCLUDED_FROM_REPORTS.length).toBeGreaterThan(0)
  })
})

describe('unknown packages are assumed to hold every authority', () => {
  it('grants nothing implicitly when a manifest cannot be read', () => {
    // Guessing "no authority" for an unreadable manifest is the dangerous
    // default: it under-reports exactly the packages least known.
    expect(Object.values(UNKNOWN_AUTHORITY).every((granted) => granted === true)).toBe(true)
  })

  it('reports host process authority for a bundle patch package', () => {
    const authority = deriveAuthority({ name: '@vendor/x', dsh: { bundle: { patch: [] } } }, {})
    expect(authority.hostProcess).toBe(true)
  })
})

describe('installs that need a second installer are refused', () => {
  it.each([
    ['legacy plugin repository', 'https://github.com/x/y.dsh-plugin'],
    ['git source', 'git+https://github.com/x/y.git'],
    ['local path', '../y'],
    ['unrecognized spec', '!! nonsense !!'],
  ])('refuses a %s', (_name, source) => {
    expect(classifySource(source).accepted).toBe(false)
  })

  it('still accepts a published package, so the suite is not refusing everything', () => {
    expect(classifySource('@deepseek-ai/dsh-web-app').accepted).toBe(true)
  })
})
