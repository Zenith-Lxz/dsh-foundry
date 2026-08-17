import { mkdirSync, mkdtempSync, writeFileSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { findSessionLog, invalidationFromOutput } from '../src/driver-dsh.ts'

describe('provider and host trouble is recognized from process output', () => {
  it.each([
    ['Error: 429 Too Many Requests', 'rate-limit'],
    ['request failed: rate limit exceeded', 'rate-limit'],
    ['401 Unauthorized', 'authentication'],
    ['invalid api key supplied', 'authentication'],
    ['fetch failed: ECONNRESET', 'infrastructure'],
    ['upstream returned 503', 'infrastructure'],
    ['ENOSPC: no space left on device', 'host-noise'],
  ] as const)('classifies %s as %s', (output, cause) => {
    expect(invalidationFromOutput(output)?.cause).toBe(cause)
  })

  it('returns null for ordinary output, so a real failure stays a real failure', () => {
    // An agent that tried and failed must not be excused as infrastructure.
    expect(invalidationFromOutput('I could not find the bug in src/rank.js.')).toBeNull()
  })

  it('returns null for an empty run', () => {
    expect(invalidationFromOutput('')).toBeNull()
  })

  it('carries surrounding context so the cause can be read back', () => {
    const detail = invalidationFromOutput('step 3 of 7 failed with 429 too many requests, retrying')?.detail
    expect(detail).toMatch(/step 3 of 7/)
  })

  it('does not treat a task prompt mentioning a status code as infrastructure', () => {
    // Word-bounded matching: '404' appears in the multi-file-feature task text.
    expect(invalidationFromOutput('make the handler translate it into a 404 result')).toBeNull()
  })
})

describe('the session log of a run is found in its isolated home', () => {
  /**
   * Build a Harness home containing session logs.
   * @param entries - Project directory, session id, and modification time.
   * @returns The home path.
   */
  function homeWith(entries: readonly { project: string, session: string, mtime: number }[]): string {
    const home = mkdtempSync(join(tmpdir(), 'dsh-home-'))
    for (const entry of entries) {
      const dir = join(home, 'sessions', entry.project, entry.session)
      mkdirSync(dir, { recursive: true })
      const log = join(dir, 'session.jsonl.zstd')
      writeFileSync(log, '')
      utimesSync(log, entry.mtime, entry.mtime)
    }
    return home
  }

  it('finds the only log', () => {
    const home = homeWith([{ project: 'proj', session: 'session-1', mtime: 1000 }])
    expect(findSessionLog(home)).toContain(join('proj', 'session-1'))
  })

  it('returns null when the run wrote no session at all', () => {
    expect(findSessionLog(mkdtempSync(join(tmpdir(), 'dsh-home-')))).toBeNull()
  })

  it('returns null when the home has no sessions directory', () => {
    expect(findSessionLog(join(tmpdir(), 'definitely-not-a-home-xyz'))).toBeNull()
  })

  it('takes the newest when a home somehow holds more than one', () => {
    const home = homeWith([
      { project: 'proj', session: 'session-old', mtime: 1000 },
      { project: 'proj', session: 'session-new', mtime: 2000 },
    ])
    expect(findSessionLog(home)).toContain('session-new')
  })

  it('looks across project directories, since the workspace path is mangled into one', () => {
    const home = homeWith([
      { project: 'proj-a', session: 'session-1', mtime: 1000 },
      { project: 'proj-b', session: 'session-2', mtime: 2000 },
    ])
    expect(findSessionLog(home)).toContain('proj-b')
  })

  it('ignores a session directory with no log yet', () => {
    const home = homeWith([{ project: 'proj', session: 'session-1', mtime: 1000 }])
    mkdirSync(join(home, 'sessions', 'proj', 'session-empty'), { recursive: true })
    expect(findSessionLog(home)).toContain('session-1')
  })
})
