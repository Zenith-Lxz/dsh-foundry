/**
 * Reading a durable session log from disk.
 *
 * The log is a zstd-compressed JSONL file whose lines are storage records —
 * each record may hold several events, because streaming chunks are packed into
 * runs. Decoding goes through the official `decodeStorageRecord` export rather
 * than a private reimplementation, so a packing change upstream surfaces as a
 * decode error here instead of silently producing a short event list.
 *
 * The file is written by a live process. A truncated final line is expected
 * while a session is still running and is skipped; anything else that fails to
 * decode is reported, because a silently dropped record understates every count
 * derived from the log.
 * @module @dsh-foundry/daily-eval/session-log
 */
import { readFileSync } from 'node:fs'
import { zstdDecompressSync } from 'node:zlib'
import type { SessionEvent } from './session-metrics.ts'

/** What reading a session log produced. */
export interface ReadLogResult {
  readonly events: readonly SessionEvent[]
  /** Lines that could not be decoded, excluding a truncated tail. */
  readonly undecodable: number
  /** True when the final line was incomplete, as a live session's tail is. */
  readonly truncatedTail: boolean
}

/** Decodes one storage record into its events. */
export type RecordDecoder = (value: unknown) => SessionEvent[]

/**
 * Read and decode a session log.
 * @param path - Path to `session.jsonl.zstd`.
 * @param decode - The official storage-record decoder.
 * @returns The events in log order, with any decode problems.
 */
export function readSessionLog(path: string, decode: RecordDecoder): ReadLogResult {
  const text = decompressAllFrames(readFileSync(path))
  const lines = text.split('\n')
  const events: SessionEvent[] = []
  let undecodable = 0
  let truncatedTail = false

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index]!
    if (line.length === 0) continue
    let parsed: unknown
    try {
      parsed = JSON.parse(line)
    } catch {
      // Only the last line can legitimately be half-written.
      if (index === lines.length - 1) truncatedTail = true
      else undecodable += 1
      continue
    }
    try {
      events.push(...decode(parsed))
    } catch {
      undecodable += 1
    }
  }

  return { events, undecodable, truncatedTail }
}

/** Start of a zstd frame. A live log appends one frame per flush. */
const FRAME_MAGIC = Buffer.from([0x28, 0xb5, 0x2f, 0xfd])

/**
 * Decompress every frame in a multi-frame zstd file.
 *
 * `zstdDecompressSync` returns only the first frame, and so does the streaming
 * decoder — on a real 54 KB log that yielded 1 event instead of 207. Nothing
 * about that failure looks like an error, which is why frames are split here
 * explicitly rather than trusted to a single call.
 *
 * The magic bytes can also occur inside compressed data, producing a split that
 * is not a frame start. Such a slice fails to decompress, so it is rejoined with
 * the next slice and retried; a genuinely corrupt file exhausts the retries and
 * throws rather than returning a short log.
 * @param buffer - The whole compressed file.
 * @returns The concatenated decompressed text.
 */
function decompressAllFrames(buffer: Buffer): string {
  const starts: number[] = []
  for (let index = buffer.indexOf(FRAME_MAGIC); index !== -1; index = buffer.indexOf(FRAME_MAGIC, index + 4)) {
    starts.push(index)
  }
  if (starts.length === 0) throw new Error('not a zstd file: no frame magic found')

  const parts: Buffer[] = []
  let cursor = 0
  while (cursor < starts.length) {
    let end = cursor + 1
    let decompressed: Buffer | null = null
    while (end <= starts.length) {
      const slice = buffer.subarray(starts[cursor], end < starts.length ? starts[end]! : buffer.length)
      try {
        decompressed = zstdDecompressSync(slice)
        break
      } catch {
        // The boundary at `end` was a magic sequence inside compressed data;
        // extend through it and try again.
        end += 1
      }
    }
    if (decompressed === null) {
      throw new Error(`session log is corrupt: no valid zstd frame starting at byte ${starts[cursor]!}`)
    }
    parts.push(decompressed)
    cursor = end
  }
  return Buffer.concat(parts).toString('utf8')
}

/**
 * Load the official decoder from an installed DSH closure.
 *
 * Resolved at run time from the profile actually under test, so the decoder and
 * the log always come from the same DSH version. A decoder taken from a
 * different version could misread a packing change as missing events.
 * @param sessionModule - The imported `@deepseek-ai/dsh-session` module.
 * @returns The decoder.
 */
export function officialDecoder(sessionModule: unknown): RecordDecoder {
  const decode = (sessionModule as { decodeStorageRecord?: unknown }).decodeStorageRecord
  if (typeof decode !== 'function') {
    throw new Error(
      'the installed @deepseek-ai/dsh-session does not export decodeStorageRecord; '
      + 'session metrics cannot be read without re-qualifying against this DSH version',
    )
  }
  return decode as RecordDecoder
}
