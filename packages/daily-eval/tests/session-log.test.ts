import { execSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { zstdCompressSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'
import { officialDecoder, readSessionLog, type RecordDecoder } from '../src/session-log.ts'
import { readSessionFacts } from '../src/session-metrics.ts'

/** Decoder standing in for the official one: one record holds one event. */
const passthrough: RecordDecoder = (value) => [value as { type: string, data?: unknown }]

/**
 * Write a multi-frame zstd log, one frame per group of lines.
 * @param groups - Lines grouped into frames, as a live log appends them.
 * @returns Path to the written file.
 */
function writeLog(groups: readonly (readonly unknown[])[]): string {
  const dir = mkdtempSync(join(tmpdir(), 'session-log-'))
  const path = join(dir, 'session.jsonl.zstd')
  const frames = groups.map((group) => zstdCompressSync(Buffer.from(`${group.map((line) => JSON.stringify(line)).join('\n')}\n`)))
  writeFileSync(path, Buffer.concat(frames))
  return path
}

describe('every frame is read, not only the first', () => {
  it('reads events from all frames', () => {
    // A single decompress call returns only frame one; on a real 54 KB log that
    // silently produced 1 event instead of 207.
    const path = writeLog([
      [{ type: 'session' }],
      [{ type: 'user/message', data: { source: { kind: 'user' } } }],
      [{ type: 'assistant/message', data: { usage: { inputTokens: 10, outputTokens: 2 } } }],
    ])
    const result = readSessionLog(path, passthrough)
    expect(result.events).toHaveLength(3)
    expect(result.undecodable).toBe(0)
  })

  it('reads a log with many frames, as a long session produces', () => {
    const path = writeLog(Array.from({ length: 120 }, (_value, index) => [{ type: 'assistant/chunk', data: { step: index } }]))
    expect(readSessionLog(path, passthrough).events).toHaveLength(120)
  })

  it('reads multiple lines packed into one frame', () => {
    const path = writeLog([[{ type: 'a' }, { type: 'b' }, { type: 'c' }]])
    expect(readSessionLog(path, passthrough).events).toHaveLength(3)
  })

  it('derives the same counts a caller would get from the whole log', () => {
    const path = writeLog([
      [{ type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 10 } } }],
      [{ type: 'tool/call', data: { name: 'bash' } }],
      [{ type: 'assistant/message', data: { usage: { inputTokens: 50, outputTokens: 5 } } }],
    ])
    const facts = readSessionFacts(readSessionLog(path, passthrough).events)
    expect(facts.modelRequests).toBe(2)
    expect(facts.inputTokens).toBe(150)
  })
})

describe('a live log incomplete tail is tolerated, and nothing else is', () => {
  it('flags a truncated final line without discarding the rest', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-log-'))
    const path = join(dir, 'session.jsonl.zstd')
    writeFileSync(path, zstdCompressSync(Buffer.from('{"type":"session"}\n{"type":"user/mess')))
    const result = readSessionLog(path, passthrough)
    expect(result.events).toHaveLength(1)
    expect(result.truncatedTail).toBe(true)
    expect(result.undecodable).toBe(0)
  })

  it('counts a broken interior line as undecodable rather than skipping it silently', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-log-'))
    const path = join(dir, 'session.jsonl.zstd')
    writeFileSync(path, zstdCompressSync(Buffer.from('{"type":"a"}\nnot json\n{"type":"b"}\n')))
    const result = readSessionLog(path, passthrough)
    expect(result.events).toHaveLength(2)
    expect(result.undecodable).toBe(1)
  })
})

describe('a corrupt file fails loudly instead of reading short', () => {
  it('throws when the file is not zstd at all', () => {
    const dir = mkdtempSync(join(tmpdir(), 'session-log-'))
    const path = join(dir, 'session.jsonl.zstd')
    writeFileSync(path, Buffer.from('plain text, never compressed'))
    expect(() => readSessionLog(path, passthrough)).toThrow(/not a zstd file/)
  })
})

describe('the decoder comes from the installed DSH, not a local copy', () => {
  it('refuses a module that does not export the decoder', () => {
    expect(() => officialDecoder({})).toThrow(/decodeStorageRecord/)
  })

  it('names re-qualification as the remedy, since the log format is version-bound', () => {
    expect(() => officialDecoder({ decodeStorageRecord: 'not a function' })).toThrow(/re-qualify/)
  })

  it('accepts a module that exports it', () => {
    expect(typeof officialDecoder({ decodeStorageRecord: passthrough })).toBe('function')
  })
})

describe('real session logs decode with the official decoder', () => {
  const staged = join(
    import.meta.dirname,
    '../../../stage/darwin-arm64/runtime/node_modules/@deepseek-ai/dsh-session/lib/index.js',
  )
  let logs: string[] = []
  try {
    logs = execSync('find ~/.dsh -name "*.jsonl.zstd" -size +4k 2>/dev/null || true', { encoding: 'utf8', shell: '/bin/sh' })
      .trim().split('\n').filter(Boolean).slice(0, 3)
  } catch {
    // No Harness home on this machine; the synthetic cases above still run.
  }

  it.skipIf(logs.length === 0)('decodes a real log with no undecodable records', async () => {
    const decode = officialDecoder(await import(staged))
    for (const log of logs) {
      const result = readSessionLog(log, decode)
      expect(result.undecodable).toBe(0)
      expect(result.events.length).toBeGreaterThan(1)
    }
  })

  it.skipIf(logs.length === 0)('derives token accounting a real run actually reported', async () => {
    const decode = officialDecoder(await import(staged))
    const withUsage = logs
      .map((log) => readSessionFacts(readSessionLog(log, decode).events))
      .find((facts) => facts.modelRequests > 0)
    expect(withUsage?.inputTokens).toBeGreaterThan(0)
    expect(withUsage?.outputTokens).toBeGreaterThan(0)
  })
})
