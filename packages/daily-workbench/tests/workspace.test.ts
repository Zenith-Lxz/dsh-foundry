import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkspaceScope, toPosix } from '../src/workspace.ts'

let root: string
let outside: string
let scope: WorkspaceScope

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-workbench-'))
  outside = mkdtempSync(join(tmpdir(), 'dsh-outside-'))
  mkdirSync(join(root, 'src', 'nested'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'src', 'nested', 'deep.ts'), 'export const b = 2\n')
  writeFileSync(join(outside, 'secret.txt'), 'do not read me\n')
  // A symlink that stays inside, and one that escapes: the difference must be
  // decided by where they land, not by the fact that they are symlinks.
  symlinkSync(join(root, 'src'), join(root, 'link-inside'))
  symlinkSync(outside, join(root, 'link-outside'))
  scope = new WorkspaceScope(root)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
  rmSync(outside, { recursive: true, force: true })
})

describe('the workspace root resolves its own real path', () => {
  it('accepts paths in a workspace reached through a symlinked root', () => {
    // On macOS the temp dir is itself a symlink (/tmp -> /private/tmp), so a
    // scope that compared against the unresolved root would reject everything.
    expect(scope.resolveRelative('src/index.ts')).toMatchObject({ ok: true, relativePath: 'src/index.ts' })
  })

  it('refuses a relative root', () => {
    expect(() => new WorkspaceScope('relative/path')).toThrow(/absolute/)
  })
})

describe('paths inside the workspace resolve', () => {
  it.each([
    ['src/index.ts', 'src/index.ts'],
    ['src/nested/deep.ts', 'src/nested/deep.ts'],
    ['./src/index.ts', 'src/index.ts'],
    ['src/../src/index.ts', 'src/index.ts'],
    ['  src/index.ts  ', 'src/index.ts'],
  ])('accepts %o as %o', (input, expected) => {
    expect(scope.resolveRelative(input)).toMatchObject({ ok: true, relativePath: expected })
  })

  it('resolves the root itself to "."', () => {
    expect(scope.resolveRelative('.')).toMatchObject({ ok: true, relativePath: '.' })
  })

  it('follows a symlink that lands inside', () => {
    expect(scope.resolveRelative('link-inside/index.ts')).toMatchObject({ ok: true, relativePath: 'src/index.ts' })
  })
})

describe('paths outside the workspace are refused', () => {
  it('refuses traversal above the root', () => {
    // The parent really exists, so this exercises containment rather than the
    // earlier absence check.
    expect(scope.resolveRelative('..')).toEqual({ ok: false, failure: 'escapes-workspace' })
  })

  it('refuses traversal that dips through a real directory first', () => {
    // A textual prefix check would accept this: it starts with `src/`.
    expect(scope.resolveRelative('src/../..')).toEqual({ ok: false, failure: 'escapes-workspace' })
  })

  it('reports an escaping path to a NONEXISTENT target as missing, not as an escape', () => {
    // Deliberate: answering "escapes-workspace" here would confirm the caller
    // computed a real outside location, and answering differently by whether
    // the target exists is exactly the probe this refuses to serve.
    expect(scope.resolveRelative('../no-such-file')).toEqual({ ok: false, failure: 'missing' })
  })

  it('refuses a symlink that escapes, even though its name is inside', () => {
    expect(scope.resolveRelative('link-outside/secret.txt')).toEqual({ ok: false, failure: 'escapes-workspace' })
  })

  it.each(['/etc/passwd', '/tmp'])('refuses the absolute path %o', (path) => {
    expect(scope.resolveRelative(path)).toEqual({ ok: false, failure: 'not-relative' })
  })

  it('reports a missing path as missing without revealing whether a sibling exists', () => {
    expect(scope.resolveRelative('src/does-not-exist.ts')).toEqual({ ok: false, failure: 'missing' })
  })

  it('does not distinguish "outside and absent" from "outside and present"', () => {
    // Both answer `missing`/`escapes-workspace` rather than confirming what is
    // out there; probing existence beyond the workspace is itself a disclosure.
    const present = scope.resolveRelative('../../etc/hosts')
    expect(present.ok).toBe(false)
  })
})

describe('malformed input is refused before any syscall', () => {
  it.each([
    ['', 'empty'],
    ['   ', 'empty'],
    ['\t\n', 'empty'],
  ])('refuses %o as %s', (input, failure) => {
    expect(scope.resolveRelative(input)).toEqual({ ok: false, failure })
  })

  it('refuses a NUL byte, which truncates the path at the system-call boundary', () => {
    expect(scope.resolveRelative('src/index.ts\0.png')).toEqual({ ok: false, failure: 'invalid' })
  })
})

describe('containResolved is the fast path for produced results', () => {
  it('accepts a real path under the root', () => {
    const inside = scope.resolveRelative('src/index.ts')
    expect(inside.ok).toBe(true)
    if (!inside.ok) return
    expect(scope.containResolved(inside.absolutePath)).toMatchObject({ ok: true, relativePath: 'src/index.ts' })
  })

  it('refuses a real path outside the root', () => {
    expect(scope.containResolved(join(outside, 'secret.txt'))).toEqual({ ok: false, failure: 'escapes-workspace' })
  })
})

describe('toPosix', () => {
  it('leaves an already-POSIX path unchanged', () => {
    expect(toPosix('src/nested/deep.ts')).toBe('src/nested/deep.ts')
  })
})
