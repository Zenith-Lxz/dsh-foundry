import { describe, expect, it } from 'vitest'
import {
  MATCHES_PER_FILE,
  buildSearchView,
  describeTruncation,
  isStale,
  openRequest,
} from '../src/client/search-view.ts'
import {
  REVIEW_SCOPE_NOTE,
  actionsForRow,
  buildReviewView,
  describeUnavailable,
  type ReviewAction,
} from '../src/client/review-view.ts'
import {
  buildContextView,
  buildJobRows,
  buildSubagentRows,
  buildVerificationView,
  collectAttention,
} from '../src/client/status-views.ts'
import type { BoundedResult, SearchHit } from '../src/discovery.ts'
import type { ChangeProjection } from '../src/projection.ts'
import type { GitInspection } from '../src/git.ts'

/**
 * Build a bounded search result.
 * @param items - Hits.
 * @param truncatedBy - Why it stopped, when it did.
 * @returns The result.
 */
function hits(items: SearchHit[], truncatedBy?: BoundedResult<SearchHit>['truncatedBy']): BoundedResult<SearchHit> {
  return truncatedBy === undefined ? { items } : { items, truncatedBy }
}

const EMPTY_PROJECTION: ChangeProjection = {
  changes: [],
  verification: [],
  claimedButAbsent: [],
  hasFailingCheck: false,
  evidenceIsStale: false,
}

describe('search results group by file and stay honest about limits', () => {
  it('groups matches under their file, in line order', () => {
    const view = buildSearchView('x', hits([
      { path: 'src/b.ts', line: 9, preview: 'x' },
      { path: 'src/a.ts', line: 3, preview: 'x' },
      { path: 'src/a.ts', line: 1, preview: 'x' },
    ]))
    expect(view.groups.map((group) => group.path)).toEqual(['src/a.ts', 'src/b.ts'])
    expect(view.groups[0]!.matches.map((match) => match.line)).toEqual([1, 3])
  })

  it('caps matches per file and reports how many are hidden', () => {
    const many = Array.from({ length: MATCHES_PER_FILE + 5 }, (_value, index) => ({
      path: 'src/a.ts', line: index + 1, preview: 'x',
    }))
    const view = buildSearchView('x', hits(many))
    expect(view.groups[0]!.matches).toHaveLength(MATCHES_PER_FILE)
    expect(view.groups[0]!.hiddenMatches).toBe(5)
  })

  it('reports no truncation for a complete result', () => {
    expect(buildSearchView('x', hits([{ path: 'a', line: 1, preview: 'x' }])).truncation).toBeNull()
  })

  it.each(['entries', 'results', 'time', 'cancelled'] as const)(
    'discloses a %s truncation with what it forbids concluding',
    (reason) => {
      const notice = describeTruncation(reason)
      expect(notice.reason).toBe(reason)
      expect(notice.message.length).toBeGreaterThan(30)
    },
  )

  it('warns that a time-limited search is not evidence of absence', () => {
    // The dangerous reading of a short list is "there is nothing else".
    expect(describeTruncation('time').message).toMatch(/does not mean/i)
  })

  it('discloses the excluded directories, so an unsearched path is readable', () => {
    expect(buildSearchView('x', hits([])).excludedDirectories).toContain('node_modules')
  })

  it('marks an empty result as empty rather than as a truncated one', () => {
    const view = buildSearchView('x', hits([]))
    expect(view.empty).toBe(true)
    expect(view.truncation).toBeNull()
  })
})

describe('a result that answers an old query is never shown', () => {
  it('is stale when the query moved on', () => {
    // Searches resolve out of order; without this an old answer renders under a
    // newer question.
    expect(isStale('foo', 'foob')).toBe(true)
  })

  it('is current when the query still matches', () => {
    expect(isStale('foo', 'foo')).toBe(false)
  })

  it('treats an emptied box as a different query', () => {
    expect(isStale('foo', '')).toBe(true)
  })
})

describe('opening a hit is a request, not an action the workbench takes', () => {
  it('names the path and line without touching an editor', () => {
    expect(openRequest('src/a.ts', 12)).toEqual({ path: 'src/a.ts', line: 12 })
  })
})

describe('review separates where a change lives from who made it', () => {
  const inspection: GitInspection = {
    available: true,
    overview: { root: '.', branch: 'main', detached: false },
    entries: [
      { path: 'src/a.ts', state: 'unstaged', code: ' M' },
      { path: 'src/b.ts', state: 'staged', code: 'M ' },
      { path: 'src/c.ts', state: 'conflicted', code: 'UU' },
      { path: 'src/d.ts', state: 'untracked', code: '??' },
    ],
  }

  it('puts conflicts first, because they need a decision', () => {
    const view = buildReviewView(inspection, EMPTY_PROJECTION)
    expect(view.sections[0]!.state).toBe('conflicted')
  })

  it('keeps every state as its own section', () => {
    const view = buildReviewView(inspection, EMPTY_PROJECTION)
    expect(view.sections.map((section) => section.state)).toEqual(['conflicted', 'unstaged', 'staged', 'untracked'])
  })

  it('marks a path the agent edited and something else changed too', () => {
    const view = buildReviewView(inspection, {
      ...EMPTY_PROJECTION,
      changes: [{ path: 'src/a.ts', state: 'unstaged', attribution: 'both' }],
    })
    const row = view.sections.find((section) => section.state === 'unstaged')!.rows[0]!
    expect(row.attribution).toBe('both')
    expect(row.warning).toMatch(/does not describe its current contents/)
  })

  it('marks a change no tool call accounts for', () => {
    const view = buildReviewView(inspection, {
      ...EMPTY_PROJECTION,
      changes: [{ path: 'src/a.ts', state: 'unstaged', attribution: 'external' }],
    })
    expect(view.sections.find((section) => section.state === 'unstaged')!.rows[0]!.warning)
      .toMatch(/outside this session/)
  })

  it('reports attribution as unknown rather than assuming the agent', () => {
    const view = buildReviewView(inspection, EMPTY_PROJECTION)
    expect(view.sections.find((section) => section.state === 'staged')!.rows[0]!.attribution).toBe('unknown')
  })

  it('warns when recorded evidence no longer describes the tree', () => {
    const view = buildReviewView(inspection, { ...EMPTY_PROJECTION, evidenceIsStale: true })
    expect(view.evidenceWarning).toMatch(/no longer describes/)
  })

  it('surfaces paths the agent claims to have edited that show no change', () => {
    const view = buildReviewView(inspection, { ...EMPTY_PROJECTION, claimedButAbsent: ['src/z.ts'] })
    expect(view.claimedButAbsent).toEqual(['src/z.ts'])
  })
})

describe('the review surface offers no mutating action', () => {
  const inspection: GitInspection = {
    available: true,
    overview: { root: '.', branch: 'main', detached: false },
    entries: [{ path: 'src/a.ts', state: 'unstaged', code: ' M' }],
  }

  it('offers only refresh at the view level', () => {
    expect(buildReviewView(inspection, EMPTY_PROJECTION).actions).toEqual([{ kind: 'refresh' }])
  })

  it.each([
    ['unstaged', ' M'],
    ['staged', 'M '],
    ['untracked', '??'],
    ['conflicted', 'UU'],
  ] as const)('offers no stage, commit, or discard for a %s row', (state, code) => {
    const actions = actionsForRow({ path: 'p', state, attribution: 'unknown', code, warning: null })
    const kinds = actions.map((action: ReviewAction) => action.kind)
    for (const forbidden of ['stage', 'commit', 'discard', 'reset', 'clean', 'push', 'rebase']) {
      expect(kinds).not.toContain(forbidden)
    }
  })

  it('offers no diff for a conflicted file, whose diff is markers', () => {
    const actions = actionsForRow({ path: 'p', state: 'conflicted', attribution: 'unknown', code: 'UU', warning: null })
    expect(actions.map((action) => action.kind)).toEqual(['open-file'])
  })

  it('offers a diff for a tracked change', () => {
    const actions = actionsForRow({ path: 'p', state: 'unstaged', attribution: 'agent', code: ' M', warning: null })
    expect(actions.map((action) => action.kind)).toContain('show-diff')
  })

  it('states its own scope on every render', () => {
    expect(buildReviewView(inspection, EMPTY_PROJECTION).scopeNote).toBe(REVIEW_SCOPE_NOTE)
    expect(REVIEW_SCOPE_NOTE).toMatch(/never stages, commits, discards, or rewrites history/)
  })
})

describe('an unusable repository says so instead of showing an empty tree', () => {
  it.each(['not-a-repository', 'git-missing', 'failed'] as const)('explains %s', (reason) => {
    const view = buildReviewView({ available: false, reason }, EMPTY_PROJECTION)
    expect(view.unavailable).toBe(describeUnavailable(reason))
    expect(view.sections).toEqual([])
  })

  it('does not let a failed read read as a clean tree', () => {
    // An empty list and an unreadable repository look identical otherwise.
    expect(describeUnavailable('failed')).toMatch(/no information, not as a clean tree/)
  })

  it('still offers refresh, so a transient failure is recoverable', () => {
    expect(buildReviewView({ available: false, reason: 'failed' }, EMPTY_PROJECTION).actions)
      .toEqual([{ kind: 'refresh' }])
  })
})

describe('verification reports what ran, and what that does not prove', () => {
  it('maps a passing record to pass', () => {
    const view = buildVerificationView([{ command: 'pnpm test', exitCode: 0, sequence: 1, passed: true }], false)
    expect(view.rows[0]!.outcome).toBe('pass')
  })

  it('maps a non-zero exit to fail', () => {
    const view = buildVerificationView([{ command: 'pnpm test', exitCode: 1, sequence: 1, passed: false }], false)
    expect(view.rows[0]!.outcome).toBe('fail')
  })

  it('maps an incomplete command to unknown, not to fail', () => {
    // Reporting it as failure would blame the change for an interrupted run.
    const view = buildVerificationView([{ command: 'pnpm test', exitCode: undefined, sequence: 1, passed: false }], false)
    expect(view.rows[0]!.outcome).toBe('unknown')
    expect(view.rows[0]!.caveat).toMatch(/not evidence either way/)
  })

  it('says a pass is not a correctness claim', () => {
    expect(buildVerificationView([], false).scopeNote).toMatch(/not a statement that the change is correct/)
  })

  it('warns that evidence is stale only when there is evidence to be stale', () => {
    expect(buildVerificationView([], true).staleWarning).toBeNull()
    expect(buildVerificationView([{ command: 'x', exitCode: 0, sequence: 1, passed: true }], true).staleWarning)
      .toMatch(/Re-run verification/)
  })
})

describe('context shows a figure only when one was measured', () => {
  it('computes occupancy when both sides are reported', () => {
    const view = buildContextView({ usedTokens: 50, capacityTokens: 200, compactions: 0, lastCompactionAt: null }, false)
    expect(view.occupancy).toBe(0.25)
  })

  it('reports null occupancy when capacity is unknown', () => {
    // A bar drawn from a missing capacity is an authoritative-looking guess.
    const view = buildContextView({ usedTokens: 50, capacityTokens: null, compactions: 0, lastCompactionAt: null }, false)
    expect(view.occupancy).toBeNull()
    expect(view.caveat).toMatch(/unknown, not empty/)
  })

  it('reports null rather than dividing by zero', () => {
    const view = buildContextView({ usedTokens: 50, capacityTokens: 0, compactions: 0, lastCompactionAt: null }, false)
    expect(view.occupancy).toBeNull()
  })

  it('offers compaction only where the surface supports it', () => {
    const record = { usedTokens: 1, capacityTokens: 2, compactions: 0, lastCompactionAt: null }
    expect(buildContextView(record, false).actions).toEqual([])
    expect(buildContextView(record, true).actions).toEqual([{ kind: 'compact-now' }])
  })
})

describe('jobs offer only the controls their records support', () => {
  it('offers cancel for a running cancellable job', () => {
    const rows = buildJobRows([{ id: 'j1', label: 'build', state: 'running', startedAt: 't', cancellable: true }])
    expect(rows[0]!.actions.map((action) => action.kind)).toContain('cancel')
  })

  it('offers no cancel for a running job that cannot be cancelled', () => {
    // A button that cannot work teaches the user that buttons lie.
    const rows = buildJobRows([{ id: 'j1', label: 'build', state: 'running', startedAt: 't', cancellable: false }])
    expect(rows[0]!.actions.map((action) => action.kind)).not.toContain('cancel')
  })

  it.each(['succeeded', 'failed', 'cancelled'] as const)('offers no cancel for a %s job', (state) => {
    const rows = buildJobRows([{ id: 'j1', label: 'build', state, startedAt: 't', cancellable: true }])
    expect(rows[0]!.actions.map((action) => action.kind)).not.toContain('cancel')
  })

  it('lists running jobs first', () => {
    const rows = buildJobRows([
      { id: 'done', label: 'a', state: 'succeeded', startedAt: 't', cancellable: false },
      { id: 'live', label: 'b', state: 'running', startedAt: 't', cancellable: true },
    ])
    expect(rows[0]!.id).toBe('live')
  })
})

describe('subagents disclose a mode that differs from the parent', () => {
  it('notes a differing mode', () => {
    const rows = buildSubagentRows([{ id: 's1', label: 'reviewer', state: 'running', mode: 'adaptive' }], 'daily')
    expect(rows[0]!.modeNote).toMatch(/adaptive.*daily/)
  })

  it('says nothing when the mode matches', () => {
    const rows = buildSubagentRows([{ id: 's1', label: 'reviewer', state: 'running', mode: 'daily' }], 'daily')
    expect(rows[0]!.modeNote).toBeNull()
  })

  it('offers only reading the transcript', () => {
    const rows = buildSubagentRows([{ id: 's1', label: 'r', state: 'finished', mode: 'daily' }], 'daily')
    expect(rows[0]!.actions.map((action) => action.kind)).toEqual(['open-transcript'])
  })
})

describe('attention is assembled from the other panels', () => {
  const base = {
    conflictedPaths: [],
    failingChecks: [],
    evidenceIsStale: false,
    claimedButAbsent: [],
    failedJobs: [],
    failedSubagents: [],
  }

  it('is empty when nothing needs attention', () => {
    expect(collectAttention(base)).toEqual([])
  })

  it('ranks conflicts and failing checks above warnings and notes', () => {
    const items = collectAttention({
      ...base,
      conflictedPaths: ['src/a.ts'],
      failingChecks: ['pnpm test'],
      evidenceIsStale: true,
      claimedButAbsent: ['src/z.ts'],
    })
    expect(items.map((item) => item.severity)).toEqual(['blocking', 'blocking', 'warning', 'info'])
  })

  it('names the conflicted path, not just the count', () => {
    const items = collectAttention({ ...base, conflictedPaths: ['src/a.ts'] })
    expect(items[0]!.message).toContain('src/a.ts')
  })

  it('surfaces a failed background job', () => {
    const items = collectAttention({
      ...base,
      failedJobs: [{ id: 'j1', label: 'build', state: 'failed', startedAt: 't', actions: [] }],
    })
    expect(items[0]!.message).toMatch(/"build" failed/)
  })

  it('gives every item a stable identity, so rendering can key on it', () => {
    const items = collectAttention({ ...base, conflictedPaths: ['a', 'b'], claimedButAbsent: ['c'] })
    expect(new Set(items.map((item) => item.id)).size).toBe(items.length)
  })
})
