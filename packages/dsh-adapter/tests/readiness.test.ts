import { describe, expect, it } from 'vitest'
import { ReadinessParser } from '../src/readiness.ts'
import { OutputTail, redact, splitLines } from '../src/diagnostics.ts'

describe('ReadinessParser', () => {
  it('accepts the official loopback ready line and reports its origin and port', () => {
    const parser = new ReadinessParser()
    const outcome = parser.observe('dsh web: http://127.0.0.1:56064')
    expect(outcome).toEqual({ kind: 'ready', origin: 'http://127.0.0.1:56064', port: 56064 })
    expect(parser.origin).toBe('http://127.0.0.1:56064')
  })

  it('ignores ordinary log output so a chatty child does not fail startup', () => {
    const parser = new ReadinessParser()
    expect(parser.observe('loading profile desktop').kind).toBe('ignored')
    expect(parser.observe('').kind).toBe('ignored')
    expect(parser.observe('  warning: something happened  ').kind).toBe('ignored')
    expect(parser.origin).toBeUndefined()
  })

  it.each([
    ['http://192.168.1.20:3080', 'non-loopback-host'],
    ['http://0.0.0.0:3080', 'non-loopback-host'],
    ['http://example.com:80', 'non-loopback-host'],
    ['ftp://127.0.0.1:3080', 'unsupported-scheme'],
    ['not-a-url', 'malformed-url'],
  ])('rejects %s as %s', (address, reason) => {
    const parser = new ReadinessParser()
    const outcome = parser.observe(`dsh web: ${address}`)
    expect(outcome).toMatchObject({ kind: 'rejected', reason })
    expect(parser.origin).toBeUndefined()
  })

  it('rejects a URL with no port because the supervisor demands an OS-selected port', () => {
    const parser = new ReadinessParser()
    expect(parser.observe('dsh web: http://127.0.0.1')).toMatchObject({ kind: 'rejected', reason: 'invalid-port' })
  })

  it('accepts exactly one receipt and rejects a later one rather than repointing the window', () => {
    const parser = new ReadinessParser()
    expect(parser.observe('dsh web: http://127.0.0.1:41000').kind).toBe('ready')
    const second = parser.observe('dsh web: http://127.0.0.1:41001')
    expect(second).toMatchObject({ kind: 'rejected', reason: 'duplicate-receipt' })
    expect(parser.origin).toBe('http://127.0.0.1:41000')
  })
})

describe('splitLines', () => {
  it('reassembles a ready line split across two chunks', () => {
    const parser = new ReadinessParser()
    const first = splitLines('', 'dsh web: http://127.')
    expect(first.lines).toEqual([])
    const second = splitLines(first.rest, '0.0.1:56064\n')
    expect(second.lines).toEqual(['dsh web: http://127.0.0.1:56064'])
    expect(parser.observe(second.lines[0] ?? '').kind).toBe('ready')
  })

  it('handles CRLF output', () => {
    expect(splitLines('', 'a\r\nb\r\n').lines).toEqual(['a', 'b'])
  })
})

describe('redact', () => {
  it.each([
    ['api_key: sk-abcdef0123456789', 'sk-abcdef0123456789'],
    ['Authorization: Bearer eyJhbGciOi.abc', 'eyJhbGciOi.abc'],
    ['token=super-secret-value', 'super-secret-value'],
    ['GET /api/x?access_token=abc123&id=7', 'abc123'],
  ])('removes the secret in %s', (line, secret) => {
    expect(redact(line)).not.toContain(secret)
  })

  it('bounds a single very long line', () => {
    expect(redact('x'.repeat(9000)).length).toBeLessThan(2100)
  })
})

describe('OutputTail', () => {
  it('retains only the most recent lines so a noisy child cannot grow memory', () => {
    const tail = new OutputTail(3)
    for (let index = 0; index < 10; index += 1) tail.push(`line ${index}`)
    expect(tail.snapshot()).toEqual(['line 7', 'line 8', 'line 9'])
  })

  it('redacts on the way in, so no reader can observe the raw secret', () => {
    const tail = new OutputTail()
    tail.push('api_key: sk-0123456789abcdef')
    expect(tail.snapshot().join('')).not.toContain('sk-0123456789abcdef')
  })
})
