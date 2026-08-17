import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { READ_ONLY_SUBCOMMANDS, inspectRepository, readDiff } from '../src/git.ts'
import { WorkspaceScope } from '../src/workspace.ts'

let repo: string
let plain: string
let scope: WorkspaceScope
let plainScope: WorkspaceScope

/**
 * Run git in a fixture directory.
 * @param cwd - Directory to run in.
 * @param args - Git arguments.
 */
function git(cwd: string, ...args: string[]): void {
  execFileSync('git', args, {
    cwd,
    stdio: 'pipe',
    env: { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@e', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@e' },
  })
}

beforeAll(() => {
  repo = mkdtempSync(join(tmpdir(), 'dsh-git-'))
  git(repo, 'init', '-q', '-b', 'main')
  writeFileSync(join(repo, 'tracked.txt'), 'one\n')
  writeFileSync(join(repo, 'staged.txt'), 'staged original\n')
  mkdirSync(join(repo, 'src'), { recursive: true })
  writeFileSync(join(repo, 'src', 'app.ts'), 'export const a = 1\n')
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'initial')

  // One of each state the review surface must distinguish.
  writeFileSync(join(repo, 'tracked.txt'), 'one\ntwo\n')
  writeFileSync(join(repo, 'staged.txt'), 'staged modified\n')
  git(repo, 'add', 'staged.txt')
  writeFileSync(join(repo, 'untracked.txt'), 'new file\n')

  plain = mkdtempSync(join(tmpdir(), 'dsh-plain-'))
  writeFileSync(join(plain, 'file.txt'), 'no repository here\n')

  scope = new WorkspaceScope(repo)
  plainScope = new WorkspaceScope(plain)
})

afterAll(() => {
  rmSync(repo, { recursive: true, force: true })
  rmSync(plain, { recursive: true, force: true })
})

describe('read-only is structural', () => {
  it.each(['add', 'commit', 'reset', 'clean', 'checkout', 'push', 'rebase', 'stash', 'restore'])(
    'does not allowlist the mutating subcommand %s',
    (subcommand) => {
      expect(READ_ONLY_SUBCOMMANDS).not.toContain(subcommand)
    },
  )

  it('allowlists only inspection subcommands', () => {
    expect([...READ_ONLY_SUBCOMMANDS].sort()).toEqual(['diff', 'rev-parse', 'status', 'symbolic-ref'])
  })
})

describe('repository overview', () => {
  it('reports the root and current branch', async () => {
    const result = await inspectRepository(scope)
    expect(result.available).toBe(true)
    if (!result.available) return
    expect(result.overview.root).toBe('.')
    expect(result.overview.branch).toBe('main')
    expect(result.overview.detached).toBe(false)
  })

  it('reports a non-repository as unavailable rather than as an empty repository', async () => {
    // An empty diff here would read as "no changes", which is a different and
    // wrong statement about the workspace.
    expect(await inspectRepository(plainScope)).toEqual({ available: false, reason: 'not-a-repository' })
  })
})

describe('working-tree status distinguishes every state', () => {
  it('separates staged, unstaged, and untracked changes', async () => {
    const result = await inspectRepository(scope)
    expect(result.available).toBe(true)
    if (!result.available) return
    const byPath = new Map(result.entries.map((entry) => [entry.path, entry.state]))
    expect(byPath.get('staged.txt')).toBe('staged')
    expect(byPath.get('tracked.txt')).toBe('unstaged')
    expect(byPath.get('untracked.txt')).toBe('untracked')
  })

  it('retains the raw porcelain code so a caller can be more specific', async () => {
    const result = await inspectRepository(scope)
    if (!result.available) return
    const untracked = result.entries.find((entry) => entry.path === 'untracked.txt')
    expect(untracked?.code).toBe('??')
  })

  it('reports a clean repository as having no entries', async () => {
    const clean = mkdtempSync(join(tmpdir(), 'dsh-clean-'))
    git(clean, 'init', '-q', '-b', 'main')
    writeFileSync(join(clean, 'a.txt'), 'a\n')
    git(clean, 'add', '-A')
    git(clean, 'commit', '-qm', 'c')
    const result = await inspectRepository(new WorkspaceScope(clean))
    expect(result.available).toBe(true)
    if (result.available) expect(result.entries).toEqual([])
    rmSync(clean, { recursive: true, force: true })
  })
})

describe('merge conflicts are their own state', () => {
  it('classifies a conflicted path as conflicted, not as staged', async () => {
    const conflict = mkdtempSync(join(tmpdir(), 'dsh-conflict-'))
    git(conflict, 'init', '-q', '-b', 'main')
    writeFileSync(join(conflict, 'c.txt'), 'base\n')
    git(conflict, 'add', '-A')
    git(conflict, 'commit', '-qm', 'base')
    git(conflict, 'checkout', '-q', '-b', 'other')
    writeFileSync(join(conflict, 'c.txt'), 'other\n')
    git(conflict, 'commit', '-qam', 'other')
    git(conflict, 'checkout', '-q', 'main')
    writeFileSync(join(conflict, 'c.txt'), 'main\n')
    git(conflict, 'commit', '-qam', 'main')
    try {
      git(conflict, 'merge', 'other')
    } catch {
      // The merge is expected to conflict; that is the fixture.
    }
    const result = await inspectRepository(new WorkspaceScope(conflict))
    expect(result.available).toBe(true)
    if (result.available) {
      // 'UU' would read as staged if the first character were tested first.
      expect(result.entries.find((entry) => entry.path === 'c.txt')?.state).toBe('conflicted')
    }
    rmSync(conflict, { recursive: true, force: true })
  })
})

describe('diff rendering', () => {
  it('renders unstaged changes by default', async () => {
    const diff = await readDiff(scope)
    expect(diff.text).toContain('tracked.txt')
    expect(diff.text).toContain('+two')
    expect(diff.truncated).toBe(false)
  })

  it('renders staged changes separately', async () => {
    const diff = await readDiff(scope, { staged: true })
    expect(diff.text).toContain('staged.txt')
    expect(diff.text).not.toContain('tracked.txt')
  })

  it('filters to one path', async () => {
    const diff = await readDiff(scope, { path: 'tracked.txt' })
    expect(diff.text).toContain('tracked.txt')
  })

  it('refuses a path outside the workspace before invoking git', async () => {
    await expect(readDiff(scope, { path: '../escape.txt' })).rejects.toThrow(/not inside the workspace/)
  })

  it('does not change the index or worktree', async () => {
    const before = await inspectRepository(scope)
    await readDiff(scope)
    await readDiff(scope, { staged: true })
    const after = await inspectRepository(scope)
    expect(JSON.stringify(after)).toBe(JSON.stringify(before))
  })
})
