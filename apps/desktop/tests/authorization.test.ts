/**
 * The native bridge refuses every sender that is not the current owner.
 *
 * This is the security decision of the whole bridge: it is what stops an
 * embedded frame, a stale renderer, a replaced window, or a document that
 * merely shares the origin from driving native operations. It was previously
 * reachable only through Electron's `ipcMain`, so none of these cases had a
 * test — the checks were read, not exercised.
 * @module apps/desktop/tests/authorization.test
 */
import { describe, expect, it } from 'vitest'
import { authorizationFailure, type SenderFacts } from '../src/main/bridge.ts'

const OWNED_ORIGIN = 'http://127.0.0.1:56064'

/** The facts of a request that should be authorized. */
const owner: SenderFacts = {
  windowLive: true,
  ownedOrigin: OWNED_ORIGIN,
  ownedWebContentsId: 7,
  senderWebContentsId: 7,
  senderIsMainFrame: true,
  senderUrl: `${OWNED_ORIGIN}/`,
}

/**
 * One request differing from the owner in the stated way.
 * @param overrides - Facts to change.
 * @returns The facts to judge.
 */
const facts = (overrides: Partial<SenderFacts>): SenderFacts => ({ ...owner, ...overrides })

describe('the current owner is authorized', () => {
  it('accepts the owned window main frame on the owned origin', () => {
    expect(authorizationFailure(owner, 'pickDirectory')).toBeUndefined()
  })

  it('accepts a deeper path on the same origin, since authority is per origin', () => {
    expect(authorizationFailure(facts({ senderUrl: `${OWNED_ORIGIN}/session/abc?x=1` }), 'describe'))
      .toBeUndefined()
  })
})

describe('a request that is not the owner is refused', () => {
  it.each<[string, Partial<SenderFacts>, string]>([
    ['the window is gone', { windowLive: false }, 'no live owned window'],
    ['no origin is ready yet', { ownedOrigin: undefined }, 'no owned host origin is currently ready'],
    ['a different webContents', { senderWebContentsId: 8 }, 'sender is not the owned window'],
    ['a child frame', { senderIsMainFrame: false }, 'sender is not the main frame'],
    ['a foreign origin', { senderUrl: 'https://example.test/' }, 'sender origin is not the owned host origin'],
    ['a different loopback port', { senderUrl: 'http://127.0.0.1:1/' }, 'sender origin is not the owned host origin'],
    ['a different loopback host spelling', { senderUrl: 'http://localhost:56064/' }, 'sender origin is not the owned host origin'],
    ['an unparsable sender URL', { senderUrl: 'not a url' }, 'sender origin is not the owned host origin'],
    ['no sender URL at all', { senderUrl: undefined }, 'sender origin is not the owned host origin'],
    ['a file URL', { senderUrl: 'file:///etc/passwd' }, 'sender origin is not the owned host origin'],
  ])('refuses %s', (_case, overrides, detail) => {
    const failure = authorizationFailure(facts(overrides), 'pickDirectory')
    expect(failure).toBeDefined()
    expect(failure!.message).toContain(detail)
  })

  it('reports a destroyed window as window-gone, not as unauthorized', () => {
    // The two are different situations for the caller: one is a race with
    // shutdown, the other is a request that should never have been made.
    expect(authorizationFailure(facts({ windowLive: false }), 'pickDirectory')!.code).toBe('window-gone')
  })

  it('reports every identity mismatch as unauthorized', () => {
    for (const overrides of [
      { senderWebContentsId: 8 },
      { senderIsMainFrame: false },
      { senderUrl: 'https://example.test/' },
      { ownedOrigin: undefined },
    ] satisfies Partial<SenderFacts>[]) {
      expect(authorizationFailure(facts(overrides), 'pickDirectory')!.code).toBe('unauthorized')
    }
  })

  it('names the requested operation, so a refusal is attributable', () => {
    expect(authorizationFailure(facts({ senderIsMainFrame: false }), 'setWindowAction')!.operation)
      .toBe('setWindowAction')
  })

  it('leaks no sender value into the message', () => {
    const failure = authorizationFailure(facts({ senderUrl: 'https://secret.internal/token/abcdef' }), 'describe')
    expect(failure!.message).not.toContain('secret.internal')
    expect(failure!.message).not.toContain('abcdef')
  })
})

describe('checks are ordered so the most fundamental answer wins', () => {
  it('reports the missing window even when the sender is also wrong', () => {
    // A destroyed window makes every other fact meaningless, and reporting a
    // sender mismatch instead would send a reader chasing renderer identity.
    const failure = authorizationFailure(
      facts({ windowLive: false, senderWebContentsId: 99, senderUrl: 'https://example.test/' }),
      'pickDirectory',
    )
    expect(failure!.code).toBe('window-gone')
  })

  it('reports the unready origin before the sender identity', () => {
    const failure = authorizationFailure(
      facts({ ownedOrigin: undefined, senderWebContentsId: 99 }),
      'pickDirectory',
    )
    expect(failure!.message).toContain('no owned host origin is currently ready')
  })
})
