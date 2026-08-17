import { describe, expect, it } from 'vitest'
import {
  DESKTOP_OPERATIONS,
  DesktopBridgeError,
  MAX_REQUEST_BYTES,
  MAX_STRING_BYTES,
  isBridgeCompatible,
  parseOpenExternalRequest,
  parsePickDirectoryRequest,
  parseRequestEnvelope,
  parseSetWindowTitleRequest,
  parseWindowActionRequest,
  requireOperation,
  MAX_TITLE_LENGTH,
  type DesktopCapabilitiesV1,
} from '../src/index.ts'

/**
 * Assert a call rejects with a specific bridge failure class.
 * @param run - The call under test.
 * @param code - Expected failure class.
 */
function expectFailure(run: () => unknown, code: string): void {
  try {
    run()
    expect.unreachable('the request must be rejected before any native operation runs')
  } catch (error) {
    expect(error).toBeInstanceOf(DesktopBridgeError)
    expect((error as DesktopBridgeError).code).toBe(code)
  }
}

describe('the operation set is closed', () => {
  it('accepts exactly the declared operations', () => {
    for (const operation of DESKTOP_OPERATIONS) expect(requireOperation(operation)).toBe(operation)
  })

  it.each([
    'invoke',
    'readFile',
    'exec',
    'ipcRenderer',
    '__proto__',
    'constructor',
    'toString',
    'describe ',
    'DESCRIBE',
  ])('rejects %s without dynamic dispatch', (name) => {
    expectFailure(() => requireOperation(name), 'unknown-operation')
  })

  it.each([[undefined], [null], [42], [{}], [[]], [() => 'describe']])('rejects the non-string %s', (value) => {
    expectFailure(() => requireOperation(value), 'unknown-operation')
  })
})

describe('envelope validation', () => {
  it('accepts a well-formed envelope', () => {
    expect(parseRequestEnvelope({ operation: 'describe', payload: undefined })).toEqual({
      operation: 'describe',
      payload: undefined,
    })
  })

  it.each([[null], ['describe'], [42], [['describe']]])('rejects the non-object envelope %s', (value) => {
    expectFailure(() => parseRequestEnvelope(value), 'invalid-request')
  })

  it('rejects an oversized envelope before it reaches an operation', () => {
    const payload = { requestId: 'a', title: 'x'.repeat(MAX_REQUEST_BYTES) }
    expectFailure(() => parseRequestEnvelope({ operation: 'pickDirectory', payload }), 'invalid-request')
  })
})

describe('pickDirectory validation', () => {
  it('accepts a request with only a requestId', () => {
    expect(parsePickDirectoryRequest({ requestId: 'r-1' })).toEqual({ requestId: 'r-1' })
  })

  it('carries an optional title through', () => {
    expect(parsePickDirectoryRequest({ requestId: 'r-1', title: 'Choose' })).toEqual({
      requestId: 'r-1',
      title: 'Choose',
    })
  })

  it.each([
    [{}, 'a missing requestId'],
    [{ requestId: '' }, 'an empty requestId'],
    [{ requestId: 7 }, 'a non-string requestId'],
    [{ requestId: 'r', title: 5 }, 'a non-string title'],
    ['r-1', 'a non-object payload'],
  ])('rejects %o (%s)', (payload) => {
    expectFailure(() => parsePickDirectoryRequest(payload), 'invalid-request')
  })

  it('rejects an oversized string field', () => {
    expectFailure(
      () => parsePickDirectoryRequest({ requestId: 'r', title: 'x'.repeat(MAX_STRING_BYTES + 1) }),
      'invalid-request',
    )
  })
})

describe('window action validation', () => {
  it.each(['minimize', 'toggle-maximize', 'close', 'toggle-fullscreen'])('accepts %s', (action) => {
    expect(parseWindowActionRequest({ action })).toEqual({ action })
  })

  it.each([
    { action: 'destroy' },
    { action: 'openDevTools' },
    { action: '' },
    { action: 42 },
    {},
  ])('rejects %o before Electron is invoked', (payload) => {
    expectFailure(() => parseWindowActionRequest(payload), 'invalid-request')
  })
})

describe('setWindowTitle validation', () => {
  it('accepts an ordinary title unchanged', () => {
    expect(parseSetWindowTitleRequest({ title: 'ppt — 需求梳理' })).toEqual({ title: 'ppt — 需求梳理' })
  })

  it.each([
    [{}, 'a missing title'],
    [{ title: 42 }, 'a non-string title'],
    [{ title: '' }, 'an empty title'],
    [{ title: '   ' }, 'a whitespace-only title'],
    ['ppt', 'a non-object payload'],
  ])('rejects %o (%s)', (payload) => {
    expectFailure(() => parseSetWindowTitleRequest(payload), 'invalid-request')
  })

  it('collapses newlines and runs of whitespace into a single line', () => {
    // Session titles can carry a stray newline; the title is cosmetic, so the
    // value is normalized rather than refused.
    expect(parseSetWindowTitleRequest({ title: 'ppt\n\n  需求   梳理 ' })).toEqual({ title: 'ppt 需求 梳理' })
  })

  it.each([
    ['\u0000', 'a NUL that can truncate the string in native chrome'],
    ['\u001B', 'an escape control'],
    ['\u009F', 'a C1 control'],
  ])('strips the control character %j (%s)', (control) => {
    const result = parseSetWindowTitleRequest({ title: `ppt${control}notes` })
    expect(result.title).not.toContain(control)
  })

  it.each(['\u202E', '\u202A', '\u2066', '\u2069'])(
    'strips the bidirectional override %j, which can reorder text around the title',
    (override) => {
      const result = parseSetWindowTitleRequest({ title: `ppt${override}notes` })
      expect(result.title).not.toContain(override)
      expect(result.title).toBe('pptnotes')
    },
  )

  it('bounds the title so operating-system chrome is not flooded', () => {
    const result = parseSetWindowTitleRequest({ title: 'x'.repeat(5000) })
    expect([...result.title].length).toBe(MAX_TITLE_LENGTH)
  })

  it('counts astral characters as single code points when bounding', () => {
    const result = parseSetWindowTitleRequest({ title: '🐋'.repeat(400) })
    expect([...result.title].length).toBe(MAX_TITLE_LENGTH)
    expect(result.title.endsWith('🐋')).toBe(true)
  })
})

describe('external URL validation', () => {
  it.each(['https://example.com/docs', 'http://127.0.0.1:3000/x?a=1'])('accepts %s', (url) => {
    expect(parseOpenExternalRequest({ url })).toEqual({ url })
  })

  it.each([
    'file:///etc/passwd',
    'javascript:alert(1)',
    'data:text/html,<script>x</script>',
    'chrome://settings',
    'vbscript:msgbox',
    '/relative/path',
    'example.com',
  ])('rejects %s so it never reaches the operating system opener', (url) => {
    expectFailure(() => parseOpenExternalRequest({ url }), 'invalid-request')
  })
})

describe('bridge compatibility', () => {
  const capabilities: DesktopCapabilitiesV1 = {
    bridgeVersion: 1,
    platform: 'darwin',
    arch: 'arm64',
    appVersion: '0.1.0',
    dshVersion: '0.1.0-rc.6',
    electronVersion: '43.4.0',
    operations: ['describe', 'pickDirectory'],
    windowControls: 'macos-traffic-lights',
    pathSeparator: '/',
  }

  it('accepts a matching version serving every required operation', () => {
    expect(isBridgeCompatible(capabilities, ['describe', 'pickDirectory'])).toBe(true)
  })

  it('refuses when a required operation is not served', () => {
    expect(isBridgeCompatible(capabilities, ['describe', 'openExternal'])).toBe(false)
  })

  it('refuses a different bridge major version', () => {
    expect(isBridgeCompatible({ ...capabilities, bridgeVersion: 2 as 1 }, ['describe'])).toBe(false)
  })
})

describe('failure diagnostics stay bounded and non-sensitive', () => {
  it('names the operation and class without carrying a payload', () => {
    const error = new DesktopBridgeError('unauthorized', 'pickDirectory', 'sender origin is not the owned host origin')
    expect(error.message).toContain('pickDirectory')
    expect(error.message).toContain('unauthorized')
    expect(error.code).toBe('unauthorized')
  })

  it('never embeds a selected path, because the failure never receives one', () => {
    const error = new DesktopBridgeError('operating-system-error', 'pickDirectory')
    expect(error.message).not.toMatch(/\/Users\/|C:\\/)
  })
})
