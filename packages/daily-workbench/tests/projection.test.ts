import { describe, expect, it } from 'vitest'
import { isVerificationCommand, projectChanges, type DurableEvent } from '../src/projection.ts'
import type { GitStatusEntry } from '../src/git.ts'

const ROOT = '/work/project'

/**
 * Build a recorded tool call.
 * @param seq - Event sequence.
 * @param name - Tool name.
 * @param args - Tool arguments.
 * @param callId - Correlation id.
 * @returns The event.
 */
function call(seq: number, name: string, args: Record<string, unknown>, callId = `c${seq}`): DurableEvent {
  return { type: 'tool/call', seq, data: { name, arguments: JSON.stringify(args), callId } }
}

/**
 * Build a recorded tool result.
 * @param seq - Event sequence.
 * @param callId - Correlation id of the call.
 * @param result - Result payload.
 * @param isError - Error flag.
 * @returns The event.
 */
function result(seq: number, callId: string, isError?: boolean): DurableEvent {
  return {
    type: 'tool/result',
    seq,
    data: {
      message: {
        source: { callId },
        content: [{ ...(isError === undefined ? {} : { isError }) }],
      },
    },
  }
}

/**
 * Build a status entry.
 * @param path - Changed path.
 * @param state - Change state.
 * @returns The entry.
 */
function changed(path: string, state: GitStatusEntry['state'] = 'unstaged'): GitStatusEntry {
  return { path, state, code: ' M' }
}

describe('verification command recognition', () => {
  it.each([
    'npm test',
    'pnpm run typecheck',
    'yarn lint',
    'node --test',
    'pytest -q',
    'cargo test',
    'make check',
    'npx tsc --noEmit',
    'vitest run',
  ])('recognizes %o', (command) => {
    expect(isVerificationCommand(command)).toBe(true)
  })

  it.each([
    'ls -la',
    'cat package.json',
    'git status',
    'echo done',
    'mkdir src',
  ])('does not promote %o into evidence', (command) => {
    // A broad pattern would let an incidental command stand in for a check,
    // which is exactly the inflation this projection exists to prevent.
    expect(isVerificationCommand(command)).toBe(false)
  })
})

describe('verification evidence comes from recorded outcomes', () => {
  it('records a passing check with its exit code', () => {
    const events = [
      call(1, 'bash', { command: 'npm test' }),
      result(2, 'c1', false),
    ]
    const projection = projectChanges(events, [], ROOT)
    expect(projection.verification).toEqual([
      // No exit code: this runtime records an error flag, and inventing a 0
      // would assert a status nothing observed.
      { command: 'npm test', exitCode: undefined, sequence: 1, passed: true },
    ])
    expect(projection.hasFailingCheck).toBe(false)
  })

  it('records a failing check and flags it', () => {
    const events = [call(1, 'bash', { command: 'npm test' }), result(2, 'c1', true)]
    const projection = projectChanges(events, [], ROOT)
    expect(projection.verification[0]?.passed).toBe(false)
    expect(projection.hasFailingCheck).toBe(true)
  })

  it('treats an unrecorded outcome as NOT passing', () => {
    // The strongest rule here: absence of an exit code is not success. A
    // surface that defaulted to 0 would report unverified work as checked.
    const events = [call(1, 'bash', { command: 'npm test' })]
    const projection = projectChanges(events, [], ROOT)
    expect(projection.verification[0]?.exitCode).toBeUndefined()
    expect(projection.verification[0]?.passed).toBe(false)
    expect(projection.hasFailingCheck).toBe(true)
  })

  it('treats a result whose flag is absent as unverified', () => {
    const events = [call(1, 'bash', { command: 'npm test' }), result(2, 'c1')]
    expect(projectChanges(events, [], ROOT).verification[0]?.passed).toBe(false)
  })

  it('matches a result to its call through the nested source id', () => {
    // The correlation id lives inside the result message; a flattened reading
    // never matches and reports every check as unverified.
    const events = [call(1, 'bash', { command: 'npm test' }, 'call_00_abc'), result(2, 'call_00_abc', false)]
    expect(projectChanges(events, [], ROOT).verification[0]?.passed).toBe(true)
  })

  it('never derives evidence from assistant prose', () => {
    // An assistant message claiming success contributes nothing.
    const events: DurableEvent[] = [
      { type: 'assistant/message', seq: 1 },
    ]
    expect(projectChanges(events, [], ROOT).verification).toEqual([])
  })
})

describe('change attribution', () => {
  it('attributes a path the agent wrote', () => {
    const events = [call(1, 'write', { file_path: `${ROOT}/src/index.ts` })]
    const projection = projectChanges(events, [changed('src/index.ts')], ROOT)
    expect(projection.changes).toEqual([
      { path: 'src/index.ts', state: 'unstaged', attribution: 'agent' },
    ])
  })

  it('attributes an unrecorded change as external, not as the agent’s work', () => {
    const projection = projectChanges([], [changed('src/other.ts')], ROOT)
    expect(projection.changes[0]?.attribution).toBe('external')
  })

  it.each(['write', 'edit', 'str_replace_editor'])('recognizes %s as an editing tool', (tool) => {
    const events = [call(1, tool, { file_path: `${ROOT}/a.ts` })]
    expect(projectChanges(events, [changed('a.ts')], ROOT).changes[0]?.attribution).toBe('agent')
  })

  it('normalizes an absolute recorded path against the workspace root', () => {
    // Comparing an absolute record against a relative status entry is how an
    // agent edit gets misreported as an external change.
    const events = [call(1, 'write', { file_path: `${ROOT}/src/deep/file.ts` })]
    expect(projectChanges(events, [changed('src/deep/file.ts')], ROOT).changes[0]?.attribution).toBe('agent')
  })

  it('reports an edit the working tree does not show', () => {
    const events = [call(1, 'write', { file_path: `${ROOT}/src/reverted.ts` })]
    const projection = projectChanges(events, [], ROOT)
    expect(projection.claimedButAbsent).toEqual(['src/reverted.ts'])
  })
})

describe('stale evidence', () => {
  it('flags a check that ran before the last edit', () => {
    const events = [
      call(1, 'bash', { command: 'npm test' }),
      result(2, 'c1', false),
      call(3, 'write', { file_path: `${ROOT}/src/late.ts` }),
    ]
    const projection = projectChanges(events, [changed('src/late.ts')], ROOT)
    expect(projection.evidenceIsStale).toBe(true)
    // The evidence is still real — it just no longer describes this tree.
    expect(projection.verification[0]?.passed).toBe(true)
  })

  it('does not flag a check that ran after the last edit', () => {
    const events = [
      call(1, 'write', { file_path: `${ROOT}/src/early.ts` }),
      call(2, 'bash', { command: 'npm test' }),
      result(3, 'c2', false),
    ]
    expect(projectChanges(events, [changed('src/early.ts')], ROOT).evidenceIsStale).toBe(false)
  })

  it('is not stale when no check ran at all', () => {
    // Staleness describes evidence that exists; absence of evidence is
    // reported by the empty verification list instead.
    const events = [call(1, 'write', { file_path: `${ROOT}/a.ts` })]
    const projection = projectChanges(events, [changed('a.ts')], ROOT)
    expect(projection.evidenceIsStale).toBe(false)
    expect(projection.verification).toEqual([])
  })
})

describe('malformed records do not break the projection', () => {
  it('ignores a call whose arguments are not valid JSON', () => {
    const events: DurableEvent[] = [
      { type: 'tool/call', seq: 1, data: { name: 'write', arguments: '{not json', callId: 'c1' } },
    ]
    expect(() => projectChanges(events, [], ROOT)).not.toThrow()
    expect(projectChanges(events, [], ROOT).changes).toEqual([])
  })

  it('ignores a call with no name', () => {
    const events: DurableEvent[] = [{ type: 'tool/call', seq: 1, data: { callId: 'c1' } }]
    expect(projectChanges(events, [], ROOT).verification).toEqual([])
  })
})
