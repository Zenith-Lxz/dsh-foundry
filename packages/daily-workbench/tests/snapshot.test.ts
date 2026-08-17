import { describe, expect, it } from 'vitest'
import {
  attentionFromSnapshot,
  commandOf,
  contextFromNodes,
  evidenceFromNodes,
  type SnapshotFacts,
} from '../src/client/snapshot.ts'

/**
 * Build a settled tool-result node.
 * @param command - Command the call ran.
 * @param isError - Whether the tool reported an error.
 * @param seq - Durable sequence.
 * @returns The node.
 */
function result(command: string, isError = false, seq = 1): { kind: string } {
  return {
    kind: 'tool-result',
    seq,
    callId: `c${seq}`,
    call: { name: 'bash', argsRaw: JSON.stringify({ command }) },
    isError,
  } as never
}

/**
 * Build snapshot facts.
 * @param overrides - Fields to override.
 * @returns The facts.
 */
function factsOf(overrides: Partial<SnapshotFacts> = {}): SnapshotFacts {
  return { nodes: [], runningCalls: [], removed: false, lastAgentError: null, subagent: null, ...overrides }
}

describe('a command is read only when the record actually carries one', () => {
  it('reads a string command from JSON arguments', () => {
    expect(commandOf('{"command":"npm test"}')).toBe('npm test')
  })

  it.each(['not json', '[]', 'null', '{"command":42}', '{"command":"  "}', '{}'])(
    'returns null for %s, rather than guessing',
    (raw) => {
      // A tool whose arguments cannot be read is one whose verification meaning
      // is unknown, not one that passed.
      expect(commandOf(raw)).toBeNull()
    },
  )
})

describe('verification evidence comes from settled tool results', () => {
  it('keeps a recognized verification command', () => {
    const rows = evidenceFromNodes([result('npm test')])
    expect(rows).toHaveLength(1)
    expect(rows[0]?.passed).toBe(true)
  })

  it('marks an errored result as not passed', () => {
    expect(evidenceFromNodes([result('npm test', true)])[0]?.passed).toBe(false)
  })

  it('ignores commands that are not verification', () => {
    expect(evidenceFromNodes([result('ls -la')])).toEqual([])
  })

  it('ignores a result whose call head was truncated out of the window', () => {
    const truncated = { kind: 'tool-result', seq: 1, callId: 'c1', call: null, isError: false }
    expect(evidenceFromNodes([truncated as never])).toEqual([])
  })

  it('ignores everything that is not a tool result', () => {
    expect(evidenceFromNodes([{ kind: 'user-message' }, { kind: 'assistant-message' }])).toEqual([])
  })

  it('orders rows by durable sequence, not by array position', () => {
    const rows = evidenceFromNodes([result('npm test', false, 9), result('npm run lint', false, 2)])
    expect(rows.map((row) => row.sequence)).toEqual([2, 9])
  })

  it('gives a settled result a completion marker, so a failure is not read as unknown', () => {
    // `exitCode: undefined` is reserved for "did not complete"; a settled
    // result completed, and leaving it undefined would render fail as unknown.
    expect(evidenceFromNodes([result('npm test', true)])[0]?.exitCode).not.toBeUndefined()
  })
})

describe('context reports what the snapshot has and denies what it does not', () => {
  it('leaves usage and capacity absent, because the snapshot carries neither', () => {
    const record = contextFromNodes([])
    expect(record.usedTokens).toBeNull()
    expect(record.capacityTokens).toBeNull()
  })

  it('counts compactions', () => {
    const nodes = [{ kind: 'compaction-summary', time: 1 }, { kind: 'user-message' }, { kind: 'compaction-summary', time: 2 }]
    expect(contextFromNodes(nodes as never).compactions).toBe(2)
  })

  it('reports the most recent compaction time', () => {
    const nodes = [{ kind: 'compaction-summary', time: 0 }, { kind: 'compaction-summary', time: 86_400_000 }]
    expect(contextFromNodes(nodes as never).lastCompactionAt).toBe(new Date(86_400_000).toISOString())
  })

  it('reports no compaction time when none happened', () => {
    expect(contextFromNodes([]).lastCompactionAt).toBeNull()
  })
})

describe('attention reports only what the session itself establishes', () => {
  it('is empty for an ordinary healthy session', () => {
    expect(attentionFromSnapshot(factsOf())).toEqual([])
  })

  it('blocks on a removed session', () => {
    const items = attentionFromSnapshot(factsOf({ removed: true }))
    expect(items[0]).toMatchObject({ severity: 'blocking' })
  })

  it('blocks when a subagent’s parent is unavailable, which is why it looks stuck', () => {
    const items = attentionFromSnapshot(factsOf({ subagent: { parentAvailable: false } }))
    expect(items[0]?.message).toMatch(/parent session is unavailable/)
  })

  it('stays quiet for a subagent whose parent is available', () => {
    expect(attentionFromSnapshot(factsOf({ subagent: { parentAvailable: true } }))).toEqual([])
  })

  it('surfaces the last agent error as a warning, not a block', () => {
    const items = attentionFromSnapshot(factsOf({ lastAgentError: 'rate limited' }))
    expect(items[0]).toMatchObject({ severity: 'warning', message: 'rate limited' })
  })

  it('orders blocking items before warnings', () => {
    const items = attentionFromSnapshot(factsOf({ removed: true, lastAgentError: 'x' }))
    expect(items.map((item) => item.severity)).toEqual(['blocking', 'warning'])
  })
})
