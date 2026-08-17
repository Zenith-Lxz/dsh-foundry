/**
 * A session's answers come from that session's own workspace.
 *
 * The Host once pinned one root at mount time and defaulted it to
 * `process.cwd()`. The desktop shell spawns the Host with the **home
 * directory** as its working directory, so every answer was scoped to the
 * user's whole home; and a second opened workspace would still have been
 * answered about the first. The root now comes from the session the call
 * arrived for, which the official `session` lookup resolves before the method
 * runs.
 * @module packages/daily-workbench/tests/workspace-resolution.test
 */
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { WorkbenchRemoteService, workspaceResolver, type SessionLike } from '../src/index.ts'

/**
 * A session recording a working directory.
 * @param cwd - The session's validated absolute directory, if it has one.
 * @returns The session as this plugin reads it.
 */
const sessionAt = (cwd?: string): SessionLike => ({ header: cwd === undefined ? {} : { cwd } })

describe('a session resolves to its own workspace', () => {
  it('answers with the directory the session records', () => {
    const resolve = workspaceResolver({})
    expect(resolve(sessionAt('/repos/alpha'))).toBe('/repos/alpha')
    expect(resolve(sessionAt('/repos/beta'))).toBe('/repos/beta')
  })

  it('never falls back to the launch directory', () => {
    // The packaged application's working directory is the user's home. A
    // fallback here would scope the workspace answers to all of it.
    expect(workspaceResolver({})(sessionAt())).toBeUndefined()
  })

  it('treats an empty recorded directory as no directory', () => {
    expect(workspaceResolver({})(sessionAt(''))).toBeUndefined()
  })

  it('lets an explicit configured root override the session', () => {
    expect(workspaceResolver({ workspaceRoot: '/pinned' })(sessionAt('/repos/alpha'))).toBe('/pinned')
  })
})

describe('a session with no workspace is an error, not an empty answer', () => {
  it('refuses rather than reporting a workspace with no files', () => {
    // Returning `[]` would render as "this workspace is empty", which is a
    // different and wrong statement from "this session has no workspace".
    const service = new WorkbenchRemoteService(new Context(), workspaceResolver({}))
    expect(() => service.findPaths(sessionAt(), '')).toThrow(/records no workspace directory/)
  })

  it('confines two sessions to their own trees', () => {
    const service = new WorkbenchRemoteService(new Context(), workspaceResolver({}))
    expect(() => service.findPaths(sessionAt(process.cwd()), '')).not.toThrow()
    expect(() => service.findPaths(sessionAt(), '')).toThrow(/records no workspace directory/)
  })
})
