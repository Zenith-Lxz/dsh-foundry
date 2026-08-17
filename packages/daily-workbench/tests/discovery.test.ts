import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DEFAULT_EXCLUDED_DIRECTORIES, findPaths, searchText } from '../src/discovery.ts'
import { WorkspaceScope } from '../src/workspace.ts'

let root: string
let scope: WorkspaceScope

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-discovery-'))
  const write = (relative: string, contents: string): void => {
    const full = join(root, relative)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, contents)
  }
  write('src/session/service.ts', 'export function createSession() {\n  return null\n}\n')
  write('src/session/store.ts', 'export const store = new Map()\n')
  write('src/index.ts', 'import { createSession } from "./session/service.ts"\n')
  write('README.md', '# demo\n\ncreateSession is the entry point.\n')
  write('node_modules/pkg/index.js', 'module.exports = { createSession: 1 }\n')
  write('dist/bundle.js', 'createSession()\n')
  write('.git/config', '[core]\n')
  // A binary file and an oversized file: both must be skipped by content search.
  writeFileSync(join(root, 'logo.bin'), Buffer.from([0x00, 0x01, 0x02, 0x00, 0x63, 0x72]))
  writeFileSync(join(root, 'huge.txt'), `${'x'.repeat(200)}\ncreateSession\n`)
  mkdirSync(join(root, 'src', 'empty'), { recursive: true })
  symlinkSync(join(root, 'src'), join(root, 'src-link'))
  scope = new WorkspaceScope(root)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('path discovery', () => {
  it('finds a file by fuzzy subsequence over the whole path', () => {
    const found = findPaths(scope, 'snsvc')
    expect(found.items.map((item) => item.path)).toContain('src/session/service.ts')
  })

  it('ranks an exact basename match first', () => {
    const found = findPaths(scope, 'store.ts')
    expect(found.items[0]?.path).toBe('src/session/store.ts')
  })

  it('lists directories as well as files', () => {
    const kinds = new Set(findPaths(scope, '').items.map((item) => item.kind))
    expect(kinds).toContain('directory')
    expect(kinds).toContain('file')
  })

  it.each(['node_modules', 'dist', '.git'])('excludes %s by default and says it skipped it', (directory) => {
    const found = findPaths(scope, '')
    expect(found.items.some((item) => item.path.startsWith(`${directory}/`))).toBe(false)
    expect(found.skippedDirectories).toContain(directory)
  })

  it('applies a user exclusion on top of the defaults without losing them', () => {
    const found = findPaths(scope, '', { excludeDirectories: ['session'] })
    expect(found.items.some((item) => item.path.startsWith('src/session/'))).toBe(false)
    expect(found.skippedDirectories).toContain('node_modules')
  })

  it('does not descend a symlinked directory, whose target is already reachable', () => {
    const found = findPaths(scope, '')
    expect(found.items.some((item) => item.path.startsWith('src-link/'))).toBe(false)
  })

  it('reports truncation instead of silently returning a short list', () => {
    const found = findPaths(scope, '', { limits: { maxResults: 2 } })
    expect(found.items).toHaveLength(2)
    expect(found.truncatedBy).toBe('results')
  })

  it('stops on the entry bound', () => {
    expect(findPaths(scope, '', { limits: { maxEntries: 1 } }).truncatedBy).toBe('entries')
  })

  it('honors cancellation', () => {
    const controller = new AbortController()
    controller.abort()
    expect(findPaths(scope, '', { signal: controller.signal }).truncatedBy).toBe('cancelled')
  })

  it('returns nothing truncated when everything in scope was examined', () => {
    expect(findPaths(scope, 'service.ts').truncatedBy).toBeUndefined()
  })
})

describe('text search', () => {
  it('finds a literal match with its line number and preview', () => {
    const hits = searchText(scope, 'createSession').items.filter((hit) => hit.path === 'src/session/service.ts')
    expect(hits).toHaveLength(1)
    expect(hits[0]?.line).toBe(1)
    expect(hits[0]?.preview).toContain('createSession')
  })

  it('matches case-insensitively', () => {
    expect(searchText(scope, 'CREATESESSION').items.length).toBeGreaterThan(0)
  })

  it('searches across files and reports each hit', () => {
    const paths = new Set(searchText(scope, 'createSession').items.map((hit) => hit.path))
    expect(paths).toContain('src/session/service.ts')
    expect(paths).toContain('src/index.ts')
    expect(paths).toContain('README.md')
  })

  it('does not search excluded directories', () => {
    const paths = new Set(searchText(scope, 'createSession').items.map((hit) => hit.path))
    expect(paths.has('node_modules/pkg/index.js')).toBe(false)
    expect(paths.has('dist/bundle.js')).toBe(false)
  })

  it('skips binary files rather than decoding them into noise', () => {
    expect(searchText(scope, 'cr').items.some((hit) => hit.path === 'logo.bin')).toBe(false)
  })

  it('skips a file past the byte bound', () => {
    const hits = searchText(scope, 'createSession', { limits: { maxFileBytes: 50 } })
    expect(hits.items.some((hit) => hit.path === 'huge.txt')).toBe(false)
  })

  it('bounds the preview length', () => {
    const long = searchText(scope, 'x'.repeat(10))
    for (const hit of long.items) expect(hit.preview.length).toBeLessThanOrEqual(201)
  })

  it('returns an empty result for an empty query rather than every line', () => {
    expect(searchText(scope, '   ').items).toEqual([])
  })

  it('reports truncation when the result bound is reached', () => {
    const hits = searchText(scope, 'e', { limits: { maxResults: 3 } })
    expect(hits.items).toHaveLength(3)
    expect(hits.truncatedBy).toBe('results')
  })

  it('honors cancellation', () => {
    const controller = new AbortController()
    controller.abort()
    expect(searchText(scope, 'createSession', { signal: controller.signal }).truncatedBy).toBe('cancelled')
  })
})

describe('the default exclusion set', () => {
  it('covers VCS, dependency, build-output, cache, and IDE directories', () => {
    for (const expected of ['.git', 'node_modules', 'dist', '.cache', '.idea']) {
      expect(DEFAULT_EXCLUDED_DIRECTORIES).toContain(expected)
    }
  })
})
