import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { WorkbenchCapability } from '../src/gateway.ts'
import { isTruncationNotice, referenceCandidates } from '../src/client/reference-source.ts'

/**
 * Build a workspace on the real filesystem.
 *
 * Every unit test for the candidate logic uses a fake remote. This one drives
 * the real capability against real directories, which is where path
 * normalization, ignore rules, and containment actually happen.
 * @returns The workspace root.
 */
function realWorkspace(): string {
  const root = mkdtempSync(join(tmpdir(), 'ref-integration-'))
  mkdirSync(join(root, 'src', 'deep'), { recursive: true })
  mkdirSync(join(root, '文档'), { recursive: true })
  mkdirSync(join(root, 'my docs'), { recursive: true })
  mkdirSync(join(root, 'node_modules', 'junk'), { recursive: true })
  writeFileSync(join(root, 'rank.js'), 'export const rank = 1\n')
  writeFileSync(join(root, 'src', 'index.ts'), 'export const a = 1\n')
  writeFileSync(join(root, 'src', 'deep', 'index.ts'), 'export const b = 2\n')
  writeFileSync(join(root, '文档', '说明.md'), '# 说明\n')
  writeFileSync(join(root, 'my docs', 'read me.md'), '# read me\n')
  writeFileSync(join(root, 'node_modules', 'junk', 'index.ts'), 'export const c = 3\n')
  return root
}

const workspace = realWorkspace()
const capability = new WorkbenchCapability(workspace)

/**
 * The Host face as the `@` source consumes it, backed by the real capability.
 *
 * The envelope is not decoration. The official client Remote resolves every
 * call to `{ok, value}` and never rejects, so a double that hands back the
 * capability's return value directly tests a transport that does not exist —
 * which is how this suite stayed green while the browser threw `Cannot read
 * properties of undefined (reading 'map')` on the first keystroke.
 */
const remote = {
  findPaths: async (query: string, limits?: { readonly maxResults?: number }) =>
    ({ ok: true as const, value: capability.findPaths(query, limits) }),
}

describe('the @ source returns real candidates from a real workspace', () => {
  it('finds a file by name', async () => {
    const candidates = await referenceCandidates(remote, 'rank')
    expect(candidates.some((candidate) => candidate.name === 'rank.js')).toBe(true)
  })

  it('disambiguates two files sharing a basename', async () => {
    const candidates = await referenceCandidates(remote, 'index')
    const labels = candidates.filter((candidate) => !isTruncationNotice(candidate.name))
      .map((candidate) => candidate.description)
    // Both `src/index.ts` and `src/deep/index.ts` exist; a menu showing
    // "index.ts" twice cannot be chosen from.
    expect(new Set(labels).size).toBe(labels.length)
  })

  it('finds a path with Chinese segments', async () => {
    const candidates = await referenceCandidates(remote, '说明')
    expect(candidates.some((candidate) => candidate.name.includes('说明.md'))).toBe(true)
  })

  it('finds a path containing a space', async () => {
    const candidates = await referenceCandidates(remote, 'read')
    expect(candidates.some((candidate) => candidate.name.includes('read me.md'))).toBe(true)
  })

  it('excludes node_modules, so a dependency file never becomes a reference', async () => {
    const candidates = await referenceCandidates(remote, 'junk')
    expect(candidates.filter((candidate) => !isTruncationNotice(candidate.name))).toEqual([])
  })

  it('returns nothing for a query that matches nothing', async () => {
    const candidates = await referenceCandidates(remote, 'zzz-no-such-file')
    expect(candidates.filter((candidate) => !isTruncationNotice(candidate.name))).toEqual([])
  })

  it('emits workspace-relative paths, never absolute ones', async () => {
    const candidates = await referenceCandidates(remote, '')
    for (const candidate of candidates.filter((entry) => !isTruncationNotice(entry.name))) {
      expect(candidate.name.startsWith('/')).toBe(false)
      expect(candidate.name).not.toContain(workspace)
    }
  })
})

describe('the Host confines every request to the workspace', () => {
  it('never returns a path outside the root, even for a traversal query', async () => {
    const candidates = await referenceCandidates(remote, '../')
    for (const candidate of candidates.filter((entry) => !isTruncationNotice(entry.name))) {
      expect(candidate.name).not.toContain('..')
    }
  })

  it('reads repository status from the real workspace', async () => {
    execFileSync('git', ['init', '-q'], { cwd: workspace })
    execFileSync('git', ['config', 'user.email', 'a@b.invalid'], { cwd: workspace })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: workspace })
    execFileSync('git', ['add', 'rank.js'], { cwd: workspace })
    execFileSync('git', ['commit', '-qm', 'base'], { cwd: workspace })
    writeFileSync(join(workspace, 'rank.js'), 'export const rank = 2\n')

    const inspection = await capability.inspectRepository()
    expect(inspection.available).toBe(true)
    if (inspection.available) {
      expect(inspection.entries.some((entry) => entry.path === 'rank.js' && entry.state === 'unstaged')).toBe(true)
    }
  })

  it('reads a real diff without changing the tree', async () => {
    const before = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    const diff = await capability.readDiff()
    expect(diff.text).toContain('rank.js')
    // Read-only is the whole contract; a diff that staged something would be
    // indistinguishable from one that did not, on the patch text alone.
    const after = execFileSync('git', ['status', '--porcelain'], { cwd: workspace, encoding: 'utf8' })
    expect(after).toBe(before)
  })
})
