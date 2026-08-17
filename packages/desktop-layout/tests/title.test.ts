import { describe, expect, it } from 'vitest'
import { composeWindowTitle } from '../src/client/title.ts'

const APP = 'DeepSeek Harness'

describe('composeWindowTitle', () => {
  it('joins the workspace and the session, workspace first', () => {
    expect(composeWindowTitle('ppt', '新会话', APP)).toBe('ppt — 新会话')
  })

  it('shows the workspace alone before a session is current', () => {
    expect(composeWindowTitle('ppt', undefined, APP)).toBe('ppt')
  })

  it('shows the session alone when no workspace accounts for it', () => {
    expect(composeWindowTitle(undefined, '新会话', APP)).toBe('新会话')
  })

  it('falls back to the application name only when there is no context at all', () => {
    expect(composeWindowTitle(undefined, undefined, APP)).toBe(APP)
  })

  it.each([
    ['', '新会话', '新会话'],
    ['ppt', '', 'ppt'],
    ['   ', '   ', APP],
  ])('treats blank parts (%o, %o) as absent', (workspace, session, expected) => {
    expect(composeWindowTitle(workspace, session, APP)).toBe(expected)
  })

  it('collapses a session named after its own workspace directory', () => {
    // An untitled session falls back to the project basename, which is the
    // workspace directory name — the observed "ppt — ppt" case.
    expect(composeWindowTitle('ppt', 'ppt', APP)).toBe('ppt')
  })

  it('keeps both when they merely share a prefix', () => {
    expect(composeWindowTitle('ppt', 'ppt-notes', APP)).toBe('ppt — ppt-notes')
  })

  it('never prefixes the application name when context exists, because the menu bar already shows it', () => {
    expect(composeWindowTitle('ppt', '新会话', APP)).not.toContain(APP)
  })

  it('passes long titles through unchanged; truncation is the stylesheet ellipsis, not a string cut', () => {
    const workspace = 'a'.repeat(300)
    const session = 'b'.repeat(300)
    expect(composeWindowTitle(workspace, session, APP)).toBe(`${workspace} — ${session}`)
  })
})
