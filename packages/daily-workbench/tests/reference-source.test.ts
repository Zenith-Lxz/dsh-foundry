import { describe, expect, it, vi } from 'vitest'
import {
  CANDIDATE_LIMIT,
  REFERENCE_SOURCE_NAME,
  REFERENCE_TRIGGER,
  disambiguate,
  isTruncationNotice,
  referenceCandidates,
  referenceCodec,
  referenceInsert,
  referenceNotice,
  type WorkbenchRemote,
} from '../src/client/reference-source.ts'
import type { PathCandidate } from '../src/discovery.ts'

/** A session id; the Host resolves it to a workspace, and the fakes ignore it. */
const SESSION = 'session-test'

/**
 * Call the source for the fixed test session.
 * @param remote - The fake Host face.
 * @param query - Text typed after the trigger.
 * @returns Candidates for the menu.
 */
const referenceCandidates0 = (remote: WorkbenchRemote, query: string) =>
  referenceCandidates(remote, SESSION, query)

/**
 * Build a remote returning fixed paths.
 *
 * The answer is wrapped in the `{ok, value}` envelope because that is what the
 * official client Remote resolves to. An earlier double returned the payload
 * directly, so every test here passed against a source that read `.items` off
 * an envelope and crashed in the browser.
 * @param paths - Workspace-relative paths.
 * @param truncatedBy - Truncation reason, when the walk stopped early.
 * @returns The remote plus its call spy.
 */
function remoteOf(paths: readonly string[], truncatedBy?: string): WorkbenchRemote & {
  findPaths: ReturnType<typeof vi.fn>
} {
  const items: PathCandidate[] = paths.map((path) => ({
    path,
    kind: path.endsWith('/') ? 'directory' : 'file',
  }))
  return {
    findPaths: vi.fn(async () => ({
      ok: true as const,
      value: { items, skippedDirectories: [], ...(truncatedBy === undefined ? {} : { truncatedBy }) },
    })),
  }
}

/**
 * Build a remote whose call did not succeed.
 * @param message - What the envelope reports.
 * @returns The remote.
 */
function failingRemote(message: string): WorkbenchRemote {
  return { findPaths: async () => ({ ok: false as const, error: { code: 'internal', message } }) }
}

describe('the source binds the official trigger', () => {
  it('answers @ and names one menu group', () => {
    expect(REFERENCE_TRIGGER).toBe('@')
    expect(REFERENCE_SOURCE_NAME).toBe('files')
  })
})

describe('labels disambiguate repeated basenames', () => {
  it('keeps a basename when it is already unique', () => {
    expect(disambiguate(['src/rank.js', 'docs/readme.md'])).toEqual(['rank.js', 'readme.md'])
  })

  it('grows both rows until they differ', () => {
    // Three rows all reading `index.ts` cannot be chosen from.
    expect(disambiguate(['a/index.ts', 'b/index.ts'])).toEqual(['a/index.ts', 'b/index.ts'])
  })

  it('grows only as far as it must', () => {
    const labels = disambiguate(['deep/nested/a/index.ts', 'deep/nested/b/index.ts'])
    expect(labels).toEqual(['a/index.ts', 'b/index.ts'])
  })

  it('leaves an unambiguous row short while a colliding pair grows', () => {
    const labels = disambiguate(['x/index.ts', 'y/index.ts', 'solo.md'])
    expect(labels[2]).toBe('solo.md')
    expect(labels[0]).not.toBe(labels[1])
  })

  it('terminates on identical paths rather than growing forever', () => {
    expect(() => disambiguate(['same.ts', 'same.ts'])).not.toThrow()
  })

  it('handles a single path', () => {
    expect(disambiguate(['only.ts'])).toEqual(['only.ts'])
  })

  it('handles no paths', () => {
    expect(disambiguate([])).toEqual([])
  })
})

describe('candidates carry what a reader needs to choose', () => {
  it('returns nothing for an empty workspace result', async () => {
    expect(await referenceCandidates0(remoteOf([]), 'x')).toEqual([])
  })

  it('marks directories with a trailing separator', async () => {
    const candidates = await referenceCandidates0(remoteOf(['src/']), '')
    expect(candidates[0]?.description).toMatch(/\/$/)
  })

  it('shows the full path as a hint when the label was shortened', async () => {
    const candidates = await referenceCandidates0(remoteOf(['deep/nested/file.ts']), 'file')
    expect(candidates[0]?.hint).toBe('deep/nested/file.ts')
  })

  it('omits the hint when the label is already the full path', async () => {
    const candidates = await referenceCandidates0(remoteOf(['file.ts']), 'file')
    expect(candidates[0]?.hint).toBeUndefined()
  })

  it('handles Chinese path segments', async () => {
    const candidates = await referenceCandidates0(remoteOf(['文档/说明.md']), '说明')
    expect(candidates[0]?.name).toBe('文档/说明.md')
    expect(candidates[0]?.description).toBe('说明.md')
  })

  it('handles paths containing spaces', async () => {
    const candidates = await referenceCandidates0(remoteOf(['my docs/read me.md']), 'read')
    expect(candidates[0]?.name).toBe('my docs/read me.md')
  })

  it('asks the Host for a bounded result rather than the whole tree', async () => {
    const remote = remoteOf(['a.ts'])
    await referenceCandidates(remote, SESSION, 'a')
    expect(remote.findPaths).toHaveBeenCalledWith(SESSION, 'a', { maxResults: CANDIDATE_LIMIT })
  })

  it('appends a truncation notice naming what stopped the walk', async () => {
    const candidates = await referenceCandidates0(remoteOf(['a.ts'], 'time'), 'a')
    const last = candidates.at(-1)!
    expect(isTruncationNotice(last.name)).toBe(true)
    expect(last.name).toContain('time')
  })

  it('does not append a notice when the walk completed', async () => {
    const candidates = await referenceCandidates0(remoteOf(['a.ts']), 'a')
    expect(candidates.some((candidate) => isTruncationNotice(candidate.name))).toBe(false)
  })

  it('keeps a large directory readable by bounding the roll', async () => {
    const many = Array.from({ length: 500 }, (_value, index) => `src/file-${index}.ts`)
    const candidates = await referenceCandidates0(remoteOf(many, 'results'), '')
    // The Host is asked for a bound; a source that requested everything would
    // block the renderer on a large repository.
    expect(candidates.length).toBeLessThanOrEqual(many.length + 1)
    expect(isTruncationNotice(candidates.at(-1)!.name)).toBe(true)
  })
})

describe('picking inserts a reference, never file contents', () => {
  it('inserts the workspace-relative path', () => {
    const insert = referenceInsert('src/rank.js')
    expect(insert.ref).toBe('src/rank.js')
    expect(insert.source).toBe(REFERENCE_SOURCE_NAME)
  })

  it('labels the chip with the basename', () => {
    expect(referenceInsert('deep/nested/rank.js').label).toBe('rank.js')
  })

  it('projects to plain text as the @ form', () => {
    expect(referenceInsert('src/rank.js').clipboardText).toBe('@src/rank.js')
  })

  it('carries no file contents in any field', () => {
    const insert = referenceInsert('src/rank.js')
    expect(Object.values(insert).join(' ')).not.toMatch(/function|export|\{/)
  })
})

describe('the truncation notice is not selectable', () => {
  it('recognizes the notice', () => {
    expect(isTruncationNotice('…more matches (stopped: time)')).toBe(true)
  })

  it('does not mistake an ordinary path for one', () => {
    expect(isTruncationNotice('src/more-matches.ts')).toBe(false)
  })
})

describe('a failed call is reported, never rendered as emptiness', () => {
  it('throws with the envelope reason rather than returning nothing', async () => {
    // The official reducer closes a menu whose every group is ready-and-empty,
    // so returning `[]` here renders exactly like having no reference source
    // at all — the state a user reports as "@ does nothing".
    await expect(referenceCandidates0(failingRemote('the Host is not answering'), 'a'))
      .rejects.toThrow(/findPaths failed — internal: the Host is not answering/)
  })

  it('treats every notice as non-selectable, not only the truncation one', () => {
    expect(isTruncationNotice(referenceNotice('file references are unavailable', 'why').name)).toBe(true)
  })
})

describe('a picked reference can actually be sent', () => {
  it('supplies a codec, without which the submit attempt rejects', () => {
    // The failure this pins was reproduced in the browser: the chip inserted,
    // and pressing send produced `slash: no serializer for reference source
    // "files"` with the message stuck in the composer. The official contract
    // blocks the send rather than downgrading to the clipboard text, so a
    // missing codec is unrecoverable at send time.
    expect(typeof referenceCodec.serialize).toBe('function')
    expect(typeof referenceCodec.clipboardText).toBe('function')
  })

  it('sends the path to the model, never the file contents', async () => {
    await expect(referenceCodec.serialize('src/main.ts')).resolves.toBe('@src/main.ts')
  })

  it('projects the same text to the clipboard as the insert carries', () => {
    expect(referenceCodec.clipboardText('src/main.ts')).toBe(referenceInsert('src/main.ts').clipboardText)
  })

  it('keeps a Chinese path intact through both projections', async () => {
    expect(referenceCodec.clipboardText('文档/说明.md')).toBe('@文档/说明.md')
    await expect(referenceCodec.serialize('文档/说明.md')).resolves.toBe('@文档/说明.md')
  })
})
