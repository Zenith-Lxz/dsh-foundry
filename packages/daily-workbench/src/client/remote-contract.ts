/**
 * The workbench Remote contract, authored rather than generated.
 *
 * The official `typert` generator cannot see `@Remote` decorators in a package
 * that installs the protocol from npm instead of as a workspace sibling
 * ([request](../../../../docs/upstream-requests/0001-typert-generator-out-of-tree.md)),
 * so it emits no client descriptors for this package. That leaves two ways to
 * reach the Host, and only one of them is allowed here.
 *
 * **Not taken:** copying the generator's output, or routing workbench data over
 * Electron IPC. The first makes a generated artifact a second source of truth;
 * the second moves Harness business traffic off the official transport, which
 * `gate:coupling` rejects.
 *
 * **Taken:** author the contribution against the *public* protocol types and
 * mount it with the public `ctx.remote.$mount`. These descriptors and schemas
 * belong to this project, describe this project's own Host service, and use no
 * private upstream path. The wire calls travel the same official gateway as
 * every generated contribution.
 *
 * The cost is that these schemas restate the Host signatures by hand, so they
 * can drift. `tests/remote-contract.test.ts` pins them against the Host's real
 * method names and arities; when the generator gains out-of-tree support this
 * file is deleted rather than maintained.
 * @module @dsh-foundry/daily-workbench/client/remote-contract
 */
import { z } from 'zod'
import type { InvocationDescriptor, TypertCodec, TypertRemoteContribution } from '@deepseek-ai/dsh-typert-protocol'

/** Cordis service key the Host binds, and the wire namespace it defaults to. */
export const WORKBENCH_SERVICE = 'dshWorkbench'

/** Package that owns the Host methods. */
export const WORKBENCH_PACKAGE = '@dsh-foundry/daily-workbench'

/** Bounded result envelope shared by the two discovery methods. */
const boundedResult = <T extends z.ZodTypeAny>(item: T) => z.object({
  items: z.array(item),
  truncatedBy: z.union([
    z.literal('entries'), z.literal('results'), z.literal('time'), z.literal('cancelled'),
  ]).optional(),
  skippedDirectories: z.array(z.string()),
})

const pathCandidate = z.object({
  path: z.string(),
  kind: z.union([z.literal('file'), z.literal('directory')]),
})

const searchHit = z.object({
  path: z.string(),
  line: z.number(),
  preview: z.string(),
})

const gitStatusEntry = z.object({
  path: z.string(),
  state: z.union([
    z.literal('conflicted'), z.literal('staged'), z.literal('unstaged'), z.literal('untracked'),
  ]),
  code: z.string(),
})

// `overview` is nested, and `branch` is absent on a detached head rather than
// an empty string. An earlier version of this schema flattened the overview and
// required `branch`, which type-checked, passed its own hand-written fixture,
// and rejected every real answer at the boundary with `rejected "result"`.
const gitOverview = z.object({
  root: z.string(),
  branch: z.string().optional(),
  detached: z.boolean(),
})

const gitInspection = z.union([
  z.object({
    available: z.literal(true),
    overview: gitOverview,
    entries: z.array(gitStatusEntry),
  }),
  z.object({
    available: z.literal(false),
    reason: z.union([z.literal('not-a-repository'), z.literal('git-missing'), z.literal('failed')]),
  }),
])

const gitDiff = z.object({
  text: z.string(),
  truncated: z.boolean(),
})

const changeState = z.union([
  z.literal('conflicted'), z.literal('staged'), z.literal('unstaged'), z.literal('untracked'),
])

const changeProjection = z.object({
  changes: z.array(z.object({
    path: z.string(),
    state: changeState,
    attribution: z.union([z.literal('agent'), z.literal('external'), z.literal('both')]),
  })),
  verification: z.array(z.object({
    command: z.string(),
    exitCode: z.number().optional(),
    sequence: z.number(),
    passed: z.boolean(),
  })),
  claimedButAbsent: z.array(z.string()),
  hasFailingCheck: z.boolean(),
  evidenceIsStale: z.boolean(),
})

const provenanceEntry = z.object({
  packageName: z.string(),
  displayName: z.string(),
  version: z.string(),
  source: z.union([
    z.literal('official'), z.literal('foundry'), z.literal('user'),
    z.literal('workspace'), z.literal('unknown'),
  ]),
  evidence: z.union([z.object({ field: z.string(), value: z.string() }), z.null()]),
  profile: z.string(),
  bundle: z.union([z.string(), z.null()]),
  enabled: z.boolean(),
  foundryVerified: z.boolean(),
  disableable: z.boolean(),
  disableImpact: z.string(),
})

const pluginInventory = z.array(z.object({
  profile: z.string(),
  entries: z.array(provenanceEntry),
}))

const requestLimits = z.object({
  maxResults: z.number().optional(),
  timeBudgetMs: z.number().optional(),
}).optional()

/**
 * Build a boundary codec.
 *
 * `typeSymbol` is the diagnostic identity the gateway prints when a value fails
 * to decode. It names this project's own type, since these schemas describe
 * this project's Host rather than a generated upstream one.
 * @param method - Host method the codec belongs to.
 * @param part - Which side of the call the codec decodes.
 * @param schema - The zod schema.
 * @returns The codec.
 */
function codec(method: string, part: string, schema: z.ZodTypeAny): TypertCodec {
  return {
    mode: 'strict',
    typeSymbol: `${WORKBENCH_PACKAGE}/client/remote-contract#${method}.${part}`,
    schema,
  }
}

/**
 * Build one descriptor.
 * @param method - Public Host method name.
 * @param parameters - Ordered business parameter schemas.
 * @param result - Result schema.
 * @returns The descriptor.
 */
/**
 * The official session lookup, restated as this contract must declare it.
 *
 * The session store registers a lookup under the key `session` whose source
 * parameter is `session` and whose **wire field is `sessionId`**, and resolves
 * that id to a live Session before the Host method runs. A workspace-scoped
 * method therefore names its parameter `session`, sends `sessionId`, and
 * receives a Session — an id no store knows is refused by the runtime that owns
 * sessions rather than by this package.
 */
const SESSION_LOOKUP = { key: 'session', parameter: 'session', wire: 'sessionId' } as const

/**
 * Build one descriptor.
 * @param method - Public Host method name.
 * @param parameters - Ordered business parameter schemas.
 * @param result - Result schema.
 * @returns The descriptor.
 */
function descriptor(
  method: string,
  parameters: readonly { readonly name: string, readonly schema: z.ZodTypeAny, readonly optional?: true }[],
  result: z.ZodTypeAny,
): InvocationDescriptor {
  return {
    id: `${WORKBENCH_PACKAGE}#${WORKBENCH_SERVICE}/${method}`,
    service: WORKBENCH_SERVICE,
    namespace: WORKBENCH_SERVICE,
    method,
    invocation: { kind: 'direct' },
    parameters: parameters.map((parameter) => {
      if (parameter.name === SESSION_LOOKUP.parameter) {
        return {
          name: SESSION_LOOKUP.parameter,
          wire: SESSION_LOOKUP.wire,
          source: 'lookup' as const,
          lookup: SESSION_LOOKUP.key,
          codec: codec(method, SESSION_LOOKUP.wire, parameter.schema),
        }
      }
      return {
        name: parameter.name,
        // The wire key equals the source name for plain JSON parameters; only
        // the session lookup above renames its field.
        wire: parameter.name,
        source: 'json' as const,
        codec: codec(method, parameter.name, parameter.schema),
        // Declared only where the Host signature really accepts `undefined`;
        // marking every parameter optional would let a dropped argument decode
        // as an intentional omission.
        ...(parameter.optional === true ? { acceptsUndefined: true as const } : {}),
      }
    }),
    result: codec(method, 'result', result),
  }
}

/** Host method names, in the order the Host declares them. */
export const WORKBENCH_METHODS = [
  'findPaths',
  'searchText',
  'inspectRepository',
  'readDiff',
  'projectChanges',
  'listPlugins',
] as const

/** The contribution mounted by the client plugin. */
export const WORKBENCH_REMOTE: TypertRemoteContribution = {
  package: WORKBENCH_PACKAGE,
  descriptors: [
    // `session` is the first parameter of every workspace-scoped method. It
    // rides the wire as `sessionId` and the official lookup resolves it to a
    // live Session on the Host, so the client names only its own session and
    // never a path.
    descriptor('findPaths', [
      { name: 'session', schema: z.string() },
      { name: 'query', schema: z.string() },
      { name: 'limits', schema: requestLimits, optional: true },
    ], boundedResult(pathCandidate)),
    descriptor('searchText', [
      { name: 'session', schema: z.string() },
      { name: 'query', schema: z.string() },
      { name: 'limits', schema: requestLimits, optional: true },
    ], boundedResult(searchHit)),
    descriptor('inspectRepository', [
      { name: 'session', schema: z.string() },
    ], gitInspection),
    descriptor('readDiff', [
      { name: 'session', schema: z.string() },
      {
        name: 'options',
        schema: z.object({ staged: z.boolean().optional(), path: z.string().optional() }).optional(),
        optional: true,
      },
    ], gitDiff),
    descriptor('projectChanges', [
      { name: 'session', schema: z.string() },
      { name: 'events', schema: z.array(z.object({ type: z.string() }).passthrough()) },
    ], changeProjection),
    descriptor('listPlugins', [], pluginInventory),
  ],
}
