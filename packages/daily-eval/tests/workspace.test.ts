import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { loadCorpus, tasksForPlatform, countByCategory } from '../src/corpus.ts'
import {
  changedPaths,
  oracleAcceptsSolution,
  oracleRejectsPristine,
  outOfScopeWrites,
  provision,
  runOracle,
} from '../src/workspace.ts'
import { checkCoverage, type TaskManifest } from '../src/schema.ts'

const CORPUS = fileURLToPath(new URL('../../../corpus', import.meta.url))
const corpus = loadCorpus(CORPUS)

describe('the corpus on disk loads without problems', () => {
  it('reports no load problems', () => {
    expect(corpus.problems).toEqual([])
  })

  it('carries a version', () => {
    expect(corpus.version).toBeGreaterThan(0)
  })

  it('stamps every task with the corpus version, so a run records what it ran', () => {
    expect(corpus.tasks.every((task) => task.corpusVersion === corpus.version)).toBe(true)
  })

  it('covers every category at least once', () => {
    expect(Object.values(countByCategory(corpus.tasks)).every((count) => count > 0)).toBe(true)
  })

  it('meets every coverage floor', () => {
    // Guards the floor in both directions: dropping a task below five in any
    // category, or below forty overall, fails here rather than quietly
    // shrinking the denominator of a published rate.
    expect(checkCoverage(corpus.tasks)).toEqual([])
  })

  it('carries at least five tasks in every category', () => {
    for (const [category, count] of Object.entries(countByCategory(corpus.tasks))) {
      expect(count, category).toBeGreaterThanOrEqual(5)
    }
  })
})

describe('loading rejects a manifest that no longer matches disk', () => {
  it('reports a missing fixture rather than dropping the task', () => {
    const root = fileURLToPath(new URL('../../../corpus', import.meta.url))
    const broken = join(root, '..', 'node_modules', '.corpus-test')
    mkdirSync(join(broken, 'tasks'), { recursive: true })
    writeFileSync(join(broken, 'version.json'), '{"version":1}')
    writeFileSync(join(broken, 'tasks', 'ghost.json'), JSON.stringify({
      id: 'ghost', category: 'bug-repair', prompt: 'p', fixture: 'fixtures/ghost',
      platforms: ['darwin'], timeoutMs: 1000, allowedScope: [], userAuthority: [],
      requiresNetwork: false, oracle: { command: 'node', args: [] }, rationale: 'r',
    }))
    const loaded = loadCorpus(broken)
    expect(loaded.tasks).toHaveLength(0)
    expect(loaded.problems[0]?.problem).toMatch(/does not exist/)
  })
})

describe('every oracle discriminates in both directions', () => {
  const applicable = tasksForPlatform(corpus.tasks, process.platform)

  it.each(applicable.map((task) => [task.id, task] as const))(
    '%s rejects the untouched fixture',
    (_id, task) => {
      expect(oracleRejectsPristine(task, CORPUS)).toBeNull()
    },
    120_000,
  )

  it.each(applicable.map((task) => [task.id, task] as const))(
    '%s accepts its reference solution',
    (_id, task) => {
      expect(oracleAcceptsSolution(task, CORPUS)).toBeNull()
    },
    120_000,
  )
})

describe('workspaces are isolated from each other', () => {
  it('gives two runs of the same task independent directories', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const first = provision(task, CORPUS)
    const second = provision(task, CORPUS)
    try {
      expect(first.path).not.toBe(second.path)
      writeFileSync(join(first.path, 'src', 'rank.js'), 'export const rank = () => []\n')
      expect(readFileSync(join(second.path, 'src', 'rank.js'), 'utf8')).toContain('sort()')
    } finally {
      first.dispose()
      second.dispose()
    }
  })

  it('tolerates a repeated dispose', () => {
    const task = corpus.tasks[0]!
    const workspace = provision(task, CORPUS)
    workspace.dispose()
    expect(() => workspace.dispose()).not.toThrow()
  })

  it('runs fixture setup so a Git task has a real worktree', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'git-diff-review-01-unrelated-change')!
    const workspace = provision(task, CORPUS)
    try {
      const status = execFileSync('git', ['status', '--porcelain'], { cwd: workspace.path, encoding: 'utf8' })
      expect(status).toMatch(/src\/retry\.js/)
    } finally {
      workspace.dispose()
    }
  })
})

describe('changes are measured against the post-setup baseline', () => {
  it('reports nothing changed before the agent writes anything', () => {
    // The Git task's setup writes two files itself; counting those as agent
    // writes would report an out-of-scope write for work never done.
    const task = corpus.tasks.find((entry) => entry.id === 'git-diff-review-01-unrelated-change')!
    const workspace = provision(task, CORPUS)
    try {
      expect(changedPaths(workspace)).toEqual([])
    } finally {
      workspace.dispose()
    }
  })

  it('reports a new file the agent wrote', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const workspace = provision(task, CORPUS)
    try {
      writeFileSync(join(workspace.path, 'NOTES.md'), 'x')
      expect(changedPaths(workspace)).toContain('NOTES.md')
    } finally {
      workspace.dispose()
    }
  })
})

describe('out-of-scope writes are detected', () => {
  const task = {
    allowedScope: ['src', 'ANSWER.txt'],
  } as TaskManifest

  it('accepts a file inside an allowed directory', () => {
    expect(outOfScopeWrites(task, ['src/a.js'])).toEqual([])
  })

  it('accepts an allowed file named exactly', () => {
    expect(outOfScopeWrites(task, ['ANSWER.txt'])).toEqual([])
  })

  it('rejects a sibling whose name merely starts with an allowed one', () => {
    expect(outOfScopeWrites(task, ['srcfake/a.js'])).toEqual(['srcfake/a.js'])
  })

  it('rejects a write at the workspace root', () => {
    expect(outOfScopeWrites(task, ['package.json'])).toEqual(['package.json'])
  })

  it('ignores Git bookkeeping, which running the fixture produces', () => {
    expect(outOfScopeWrites(task, ['.git/index'])).toEqual([])
  })
})

describe('an oracle verdict carries its evidence', () => {
  it('retains the assertion text from a failing oracle', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const workspace = provision(task, CORPUS)
    try {
      const result = runOracle(task, workspace.path, CORPUS)
      expect(result.passed).toBe(false)
      expect(result.evidence).toMatch(/mixed digit lengths/)
    } finally {
      workspace.dispose()
    }
  }, 60_000)
})

describe('deletions count as changes', () => {
  it('reports a file the agent removed', () => {
    // A run that deleted its own oracle reported zero changed paths and zero
    // out-of-scope writes until this half of the diff was parsed.
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const workspace = provision(task, CORPUS)
    try {
      rmSync(join(workspace.path, 'src', 'rank.js'))
      expect(changedPaths(workspace)).toContain('src/rank.js')
    } finally {
      workspace.dispose()
    }
  })

  it('counts removing an out-of-scope file as an unsafe attempt', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'repository-navigation-01-definition-site')!
    const workspace = provision(task, CORPUS)
    try {
      rmSync(join(workspace.path, 'src', 'limits.js'))
      expect(outOfScopeWrites(task, changedPaths(workspace))).toContain('src/limits.js')
    } finally {
      workspace.dispose()
    }
  })
})

describe('the oracle is never present while the agent works', () => {
  it.each(corpus.tasks.slice(0, 6).map((task) => [task.id, task] as const))(
    '%s provisions without its verify script',
    (_id, task) => {
      // Leaving it in turned every task into "read the assertions and satisfy
      // them", which is why two very different compositions both scored 99.2%.
      const workspace = provision(task, CORPUS)
      try {
        expect(existsSync(join(workspace.path, 'verify.mjs'))).toBe(false)
      } finally {
        workspace.dispose()
      }
    },
  )

  it('still judges correctly, so hiding it did not disable the oracle', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    expect(oracleRejectsPristine(task, CORPUS)).toBeNull()
    expect(oracleAcceptsSolution(task, CORPUS)).toBeNull()
  }, 60_000)

  it('leaves no oracle behind after judging', () => {
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const workspace = provision(task, CORPUS)
    try {
      runOracle(task, workspace.path, CORPUS)
      expect(existsSync(join(workspace.path, 'verify.mjs'))).toBe(false)
    } finally {
      workspace.dispose()
    }
  }, 60_000)
})

describe('the corpus version tracks its content', () => {
  it('records a fingerprint alongside the version', () => {
    // The version once failed to bump while the content changed materially, so
    // v1 claims would have read as current against v2 data.
    const recorded = JSON.parse(readFileSync(join(CORPUS, 'version.json'), 'utf8')) as {
      version: number
      fingerprint?: string
    }
    expect(recorded.version).toBeGreaterThanOrEqual(2)
    expect(recorded.fingerprint).toMatch(/^[0-9a-f]{16}$/)
  })
})
