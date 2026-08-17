import { describe, expect, it } from 'vitest'
import { jobsFromRunningCalls } from '../src/client/WorkbenchHost.tsx'
import { badgeFor } from '../src/client/panels/Workbench.tsx'
import type { WorkbenchData } from '../src/client/panels/Workbench.tsx'

describe('running tool calls become job rows', () => {
  it('reports every listed call as running', () => {
    const rows = jobsFromRunningCalls([
      { callId: 'a', name: 'bash', time: 0 },
      { callId: 'b', name: 'str_replace_editor', time: 1000 },
    ])
    expect(rows.map((row) => row.state)).toEqual(['running', 'running'])
  })

  it('never invents an outcome, because this source cannot see one', () => {
    // A settled call leaves the snapshot, so anything still listed is running.
    // Marking one succeeded or failed would put a verdict on screen that no
    // record supports.
    const rows = jobsFromRunningCalls([{ callId: 'a', name: 'bash', time: 0 }])
    expect(rows.every((row) => row.state === 'running')).toBe(true)
  })

  it('marks jobs non-cancellable, since no cancel path reaches a tool call here', () => {
    expect(jobsFromRunningCalls([{ callId: 'a', name: 'bash', time: 0 }])[0]?.cancellable).toBe(false)
  })

  it('carries the tool name as the label and the logged time as the start', () => {
    const row = jobsFromRunningCalls([{ callId: 'a', name: 'bash', time: 1_700_000_000_000 }])[0]!
    expect(row.label).toBe('bash')
    expect(row.startedAt).toBe(new Date(1_700_000_000_000).toISOString())
  })

  it('returns nothing when no call is running', () => {
    expect(jobsFromRunningCalls([])).toEqual([])
  })
})

describe('tab badges count only what is actionable', () => {
  const base = {
    review: { repository: null, unavailable: null, sections: [], claimedButAbsent: [], evidenceWarning: null, actions: [], scopeNote: 'n' },
    verification: { rows: [], staleWarning: null, scopeNote: 'n', empty: true },
    context: { occupancy: null, usedTokens: null, capacityTokens: null, compactions: 0, lastCompactionAt: null, caveat: 'c', actions: [] },
    jobs: [],
    subagents: [],
    attention: [],
  } as unknown as WorkbenchData

  it('shows no badge when nothing needs action', () => {
    expect(badgeFor('review', base)).toBeNull()
    expect(badgeFor('jobs', base)).toBeNull()
  })

  it('counts running jobs, not total jobs', () => {
    const data = {
      ...base,
      jobs: [{ id: 'a', state: 'running' }, { id: 'b', state: 'succeeded' }],
    } as unknown as WorkbenchData
    expect(badgeFor('jobs', data)).toBe(1)
  })

  it('counts conflicts and claimed-but-absent paths on the changes tab', () => {
    const data = {
      ...base,
      review: {
        ...base.review,
        sections: [
          { state: 'conflicted', rows: [{ path: 'a' }, { path: 'b' }] },
          { state: 'unstaged', rows: [{ path: 'c' }, { path: 'd' }, { path: 'e' }] },
        ],
        claimedButAbsent: ['f'],
      },
    } as unknown as WorkbenchData
    // Three unstaged files are ordinary work, not something to flag.
    expect(badgeFor('review', data)).toBe(3)
  })

  it('counts only blocking attention items', () => {
    const data = {
      ...base,
      attention: [{ severity: 'blocking' }, { severity: 'warning' }, { severity: 'info' }],
    } as unknown as WorkbenchData
    expect(badgeFor('attention', data)).toBe(1)
  })

  it('never badges context or subagents, whose totals are not signals', () => {
    expect(badgeFor('context', base)).toBeNull()
    expect(badgeFor('subagents', base)).toBeNull()
  })
})
