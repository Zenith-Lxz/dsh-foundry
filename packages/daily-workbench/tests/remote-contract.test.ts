import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { remoteMethods } from '@deepseek-ai/dsh-typert-protocol'
import { harnessHome, inventoryHome } from '@dsh-foundry/plugin-governance'
import {
  WORKBENCH_METHODS,
  WORKBENCH_PACKAGE,
  WORKBENCH_REMOTE,
  WORKBENCH_SERVICE,
} from '../src/client/remote-contract.ts'
import { WorkbenchCapability, WorkbenchRemoteService } from '../src/index.ts'

/**
 * Host Remote methods, read from the decorator markers rather than restated.
 *
 * The markers are the same table the official Gateway consults to claim and
 * dispatch an endpoint, so this list is what is actually callable. Reading
 * prototype names instead counted private helpers as Remote methods, which made
 * the contract look wrong whenever the Host grew an internal one.
 */
const hostMethods = remoteMethods(new WorkbenchRemoteService(new Context(), () => '/tmp'))
  .map((marker) => marker.exportName ?? marker.method)

describe('the authored contract matches the Host it describes', () => {
  it('declares exactly the Host methods', () => {
    // Hand-written descriptors can drift from the Host they claim to describe.
    // This is the pin: a method added, renamed, or removed on the Host fails
    // here rather than at run time as an unknown endpoint.
    expect([...WORKBENCH_METHODS].sort()).toEqual(hostMethods.sort())
  })

  it('has one descriptor per method', () => {
    expect(WORKBENCH_REMOTE.descriptors.map((entry) => entry.method).sort())
      .toEqual([...WORKBENCH_METHODS].sort())
  })

  it('matches each Host method’s declared arity', () => {
    for (const descriptor of WORKBENCH_REMOTE.descriptors) {
      const prototype = WorkbenchRemoteService.prototype as unknown as Record<string, (...args: unknown[]) => unknown>
      const implementation = prototype[descriptor.method]!
      expect(descriptor.parameters.length, descriptor.method).toBe(implementation.length)
    }
  })

  it('names the service the Host binds', () => {
    expect(WORKBENCH_SERVICE).toBe('dshWorkbench')
  })

  it('attributes the contribution to this package, not to an upstream one', () => {
    expect(WORKBENCH_REMOTE.package).toBe(WORKBENCH_PACKAGE)
    expect(WORKBENCH_PACKAGE.startsWith('@dsh-foundry/')).toBe(true)
  })
})

describe('every codec validates rather than passing values through', () => {
  it('gives each parameter and result a strict codec', () => {
    for (const descriptor of WORKBENCH_REMOTE.descriptors) {
      expect(descriptor.result.mode, `${descriptor.method} result`).toBe('strict')
      for (const parameter of descriptor.parameters) {
        expect(parameter.codec.mode, `${descriptor.method}.${parameter.name}`).toBe('strict')
      }
    }
  })

  it('names this project in every type symbol, since these types are ours', () => {
    for (const descriptor of WORKBENCH_REMOTE.descriptors) {
      if (descriptor.result.mode !== 'strict') continue
      expect(descriptor.result.typeSymbol).toContain(WORKBENCH_PACKAGE)
    }
  })

  it('rejects a malformed result instead of forwarding it', () => {
    const inspect = WORKBENCH_REMOTE.descriptors.find((entry) => entry.method === 'inspectRepository')!
    if (inspect.result.mode !== 'strict') throw new Error('expected a strict codec')
    expect(() => { inspect.result.schema.parse({ available: 'yes' }) }).toThrow()
  })

  it('accepts the shape the Host actually returns when a repository is absent', () => {
    const inspect = WORKBENCH_REMOTE.descriptors.find((entry) => entry.method === 'inspectRepository')!
    if (inspect.result.mode !== 'strict') throw new Error('expected a strict codec')
    expect(() => { inspect.result.schema.parse({ available: false, reason: 'not-a-repository' }) }).not.toThrow()
  })
})

describe('optional parameters are declared only where the Host allows them', () => {
  it('marks limits and options as accepting undefined', () => {
    const optional = WORKBENCH_REMOTE.descriptors
      .flatMap((entry) => entry.parameters)
      .filter((parameter) => parameter.acceptsUndefined === true)
      .map((parameter) => parameter.name)
    expect(new Set(optional)).toEqual(new Set(['limits', 'options']))
  })

  it('never marks a required parameter optional', () => {
    // A dropped required argument would otherwise decode as an intentional
    // omission and reach the Host as `undefined`.
    const query = WORKBENCH_REMOTE.descriptors
      .find((entry) => entry.method === 'searchText')!
      .parameters.find((parameter) => parameter.name === 'query')!
    expect(query.acceptsUndefined).toBeUndefined()
  })

  it('sends every business parameter as plain JSON under its own name', () => {
    for (const descriptor of WORKBENCH_REMOTE.descriptors) {
      for (const parameter of descriptor.parameters) {
        if (parameter.name === 'session') continue
        expect(parameter.source, `${descriptor.method}.${parameter.name}`).toBe('json')
        expect(parameter.wire, `${descriptor.method}.${parameter.name}`).toBe(parameter.name)
      }
    }
  })

  it('declares session as the official lookup, sent as sessionId', () => {
    // The wire field is not the parameter name here: the session store's lookup
    // takes `sessionId` and resolves it to a live Session before the Host
    // method runs. Declaring it as plain JSON reaches the Gateway as
    // `missing "sessionId"; unexpected "session"` and every call fails.
    const scoped = WORKBENCH_REMOTE.descriptors
      .filter((entry) => entry.parameters.some((parameter) => parameter.name === 'session'))
    expect(scoped.map((entry) => entry.method).sort())
      .toEqual(['findPaths', 'inspectRepository', 'projectChanges', 'readDiff', 'searchText'])
    for (const descriptor of scoped) {
      const session = descriptor.parameters.find((parameter) => parameter.name === 'session')!
      expect(session.source, descriptor.method).toBe('lookup')
      expect(session.wire, descriptor.method).toBe('sessionId')
      expect(session.lookup, descriptor.method).toBe('session')
    }
  })

  it('leaves listPlugins unscoped, since it reports the profile rather than a tree', () => {
    const inventory = WORKBENCH_REMOTE.descriptors.find((entry) => entry.method === 'listPlugins')!
    expect(inventory.parameters).toEqual([])
  })
})

describe('the authored schemas accept what the Host actually returns', () => {
  /**
   * A real repository, so the answers under test are produced rather than
   * written by hand.
   *
   * An earlier version of this suite parsed literals typed next to the schema.
   * They agreed with each other and disagreed with the Host: `inspectRepository`
   * nests its overview and omits `branch` on a detached head, while the schema
   * flattened it and required the field. Both sides passed and every live call
   * was rejected at the boundary with `rejected "result"`. A fixture that is not
   * the Host's own output cannot detect that, whatever the test is called.
   * @returns The workspace root.
   */
  function repository(): string {
    const root = mkdtempSync(join(tmpdir(), 'contract-'))
    writeFileSync(join(root, 'tracked.ts'), 'export const a = 1\n')
    execFileSync('git', ['init', '-q'], { cwd: root })
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: root })
    execFileSync('git', ['config', 'user.name', 'test'], { cwd: root })
    execFileSync('git', ['add', '.'], { cwd: root })
    execFileSync('git', ['commit', '-qm', 'first'], { cwd: root })
    writeFileSync(join(root, 'tracked.ts'), 'export const a = 2\n')
    writeFileSync(join(root, 'untracked.md'), '# new\n')
    return root
  }

  const capability = new WorkbenchCapability(repository())

  /**
   * Parse one produced answer through its declared result schema.
   * @param method - Remote method name.
   * @param value - What the capability returned.
   */
  function accepts(method: string, value: unknown): void {
    const descriptor = WORKBENCH_REMOTE.descriptors.find((entry) => entry.method === method)!
    if (descriptor.result.mode !== 'strict') throw new Error(`${method}: expected a strict codec`)
    const parsed = descriptor.result.schema.safeParse(value)
    if (!parsed.success) {
      throw new Error(`${method} result rejected by its own schema: ${JSON.stringify(parsed.error.issues)}`)
    }
  }

  it('accepts a produced findPaths result', () => {
    accepts('findPaths', capability.findPaths(''))
  })

  it('accepts a produced searchText result', () => {
    accepts('searchText', capability.searchText('export'))
  })

  it('accepts a produced inspectRepository result', async () => {
    accepts('inspectRepository', await capability.inspectRepository())
  })

  it('accepts a produced readDiff result', async () => {
    accepts('readDiff', await capability.readDiff())
  })

  it('accepts a produced projectChanges result', async () => {
    accepts('projectChanges', await capability.projectChanges([]))
  })

  it('accepts a produced listPlugins result', () => {
    accepts('listPlugins', inventoryHome(harnessHome()))
  })

  it('accepts an unavailable inspection from a workspace with no repository', async () => {
    const bare = new WorkbenchCapability(mkdtempSync(join(tmpdir(), 'contract-bare-')))
    accepts('inspectRepository', await bare.inspectRepository())
  })
})
