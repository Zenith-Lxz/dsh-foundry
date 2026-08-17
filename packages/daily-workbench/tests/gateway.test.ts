import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { WorkbenchCapability } from '../src/gateway.ts'

let root: string
let capability: WorkbenchCapability

beforeAll(() => {
  root = mkdtempSync(join(tmpdir(), 'dsh-gateway-'))
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'index.ts'), 'export const marker = 1\n')
  for (let i = 0; i < 40; i += 1) writeFileSync(join(root, `f${i}.txt`), 'marker\n')
  execFileSync('git', ['init', '-q', '-b', 'main'], { cwd: root, stdio: 'pipe' })
  capability = new WorkbenchCapability(root)
})

afterAll(() => {
  rmSync(root, { recursive: true, force: true })
})

describe('the Remote surface is narrow by construction', () => {
  it('exposes only bounded workspace questions', () => {
    // A generic filesystem or process method here would hand the browser an
    // authority the agent's own tools obtain only through the permission flow.
    const surface = Object.getOwnPropertyNames(WorkbenchCapability.prototype)
      .filter((name) => name !== 'constructor')
      .sort()
    expect(surface).toEqual(['findPaths', 'inspectRepository', 'projectChanges', 'readDiff', 'searchText'])
  })

  it.each(['readFile', 'writeFile', 'exec', 'spawn', 'env', 'run', 'delete'])(
    'exposes no %s method',
    (forbidden) => {
      expect(Object.getOwnPropertyNames(WorkbenchCapability.prototype)).not.toContain(forbidden)
    },
  )
})

describe('caller limits are clamped, never trusted', () => {
  it('honors a caller asking for less work', () => {
    expect(capability.findPaths('', { maxResults: 3 }).items).toHaveLength(3)
  })

  it('refuses to let a caller raise the ceiling', () => {
    // The Host serves every session in the deployment; one request must not be
    // able to pin it for an arbitrary time or result count.
    const result = capability.findPaths('', { maxResults: 100_000, timeBudgetMs: 600_000 })
    expect(result.items.length).toBeLessThanOrEqual(500)
  })

  it.each([0, -5, Number.NaN])('ignores the nonsensical limit %s', (maxResults) => {
    expect(() => capability.findPaths('', { maxResults })).not.toThrow()
  })
})

describe('workspace questions answer through the capability', () => {
  it('finds paths', () => {
    expect(capability.findPaths('index').items.some((item) => item.path === 'src/index.ts')).toBe(true)
  })

  it('searches text', () => {
    expect(capability.searchText('marker').items.length).toBeGreaterThan(0)
  })

  it('returns nothing for an empty text query rather than every line', () => {
    expect(capability.searchText('   ').items).toEqual([])
  })

  it('coerces a non-string query instead of throwing at the wire boundary', () => {
    // The value crosses a wire boundary, so it is validated rather than trusted.
    expect(() => capability.findPaths(undefined as unknown as string)).not.toThrow()
  })

  it('inspects the repository', async () => {
    const inspection = await capability.inspectRepository()
    expect(inspection.available).toBe(true)
  })

  it('refuses a diff path outside the workspace', async () => {
    await expect(capability.readDiff({ path: '../../etc/hosts' })).rejects.toThrow(/not inside the workspace/)
  })
})

describe('change projection correlates the record with the tree', () => {
  it('reports no evidence when no checks ran', async () => {
    const projection = await capability.projectChanges([])
    expect(projection.verification).toEqual([])
    expect(projection.hasFailingCheck).toBe(false)
  })

  it('tolerates an absent event list', async () => {
    await expect(capability.projectChanges(undefined as never)).resolves.toBeDefined()
  })
})
