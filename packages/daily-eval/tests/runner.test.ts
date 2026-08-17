import { cpSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { loadCorpus } from '../src/corpus.ts'
import { classifyFailure, planRuns, runCorpus, runOnce, type AgentDriver } from '../src/runner.ts'
import { readResumeOutcome, readSessionFacts } from '../src/session-metrics.ts'
import type { ConfigurationIdentity } from '../src/schema.ts'

const CORPUS = fileURLToPath(new URL('../../../corpus', import.meta.url))
const corpus = loadCorpus(CORPUS)

/** An identity for a same-model configuration. */
function identityOf(configuration: string): ConfigurationIdentity {
  return {
    lane: 'same-model',
    configuration,
    productVersion: '0.1.0',
    model: 'test',
    reasoningEffort: null,
    platform: process.platform,
    architecture: process.arch,
    dshVersion: '0.1.0-rc.6',
  }
}

/**
 * A driver that copies the task's reference solution into the workspace.
 *
 * Stands in for a perfect agent, which is what makes the runner verifiable
 * without a model credential.
 */
function solvingDriver(configuration = 'solver'): AgentDriver {
  return {
    identity: identityOf(configuration),
    run: async (task, workspacePath) => {
      cpSync(join(CORPUS, 'solutions', task.id), workspacePath, { recursive: true })
      return {
        events: [
          { type: 'user/message', data: { source: { kind: 'user' } } },
          { type: 'tool/call', data: { name: 'str_replace_editor', callId: 'c1' } },
          { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 20 } } },
        ],
        permissionDecisions: 0,
        invalidation: null,
      }
    },
  }
}

/** A driver that does nothing, standing in for an agent that fails the task. */
function idleDriver(configuration = 'idle'): AgentDriver {
  return {
    identity: identityOf(configuration),
    run: async () => ({ events: [], permissionDecisions: null, invalidation: null }),
  }
}

const SOLVABLE = corpus.tasks.filter((task) => task.platforms.includes(process.platform))

describe('the runner produces a valid record end to end', () => {
  it.each(SOLVABLE.map((task) => [task.id, task] as const))(
    'records verified success for %s when the agent solves it',
    async (_id, task) => {
      const record = await runOnce(task, solvingDriver(), CORPUS, 1, 0)
      expect(record.invalidation).toBeNull()
      expect(record.verifiedSuccess).toBe(true)
      expect(record.metrics.finalVerificationState).toBe('pass')
      expect(record.metrics.timeToVerifiedResultMs).toBeGreaterThan(0)
      expect(record.metrics.changedPaths.length).toBeGreaterThan(0)
      expect(record.metrics.unsafeAttempts).toBe(0)
    },
    120_000,
  )

  it('records verified failure, not invalidation, when the agent does nothing', async () => {
    const record = await runOnce(corpus.tasks[0]!, idleDriver(), CORPUS, 1, 0)
    expect(record.verifiedSuccess).toBe(false)
    expect(record.invalidation).toBeNull()
    // An unsolved task has no time to a verified result; zero would read as instant.
    expect(record.metrics.timeToVerifiedResultMs).toBeNull()
  }, 60_000)

  it('retains oracle evidence so a verdict can be re-read', async () => {
    const record = await runOnce(corpus.tasks[0]!, idleDriver(), CORPUS, 1, 0)
    expect(record.oracleEvidence.length).toBeGreaterThan(0)
  }, 60_000)
})

describe('infrastructure trouble never counts as an agent failure', () => {
  it.each([
    ['429 Too Many Requests', 'rate-limit'],
    ['401 unauthorized: bad api key', 'authentication'],
    ['socket hang up', 'infrastructure'],
    ['ENOSPC: no space left on device', 'host-noise'],
    ['cannot read properties of undefined', 'runner-failure'],
  ] as const)('classifies %s as %s', (message, cause) => {
    expect(classifyFailure(new Error(message)).cause).toBe(cause)
  })

  it('produces a null verdict when the driver throws', async () => {
    const driver: AgentDriver = {
      identity: identityOf('flaky'),
      run: async () => {
        throw new Error('429 rate limited')
      },
    }
    const record = await runOnce(corpus.tasks[0]!, driver, CORPUS, 1, 0)
    // false would count a rate limit as the agent failing the task.
    expect(record.verifiedSuccess).toBeNull()
    expect(record.invalidation).toEqual({ cause: 'rate-limit', detail: '429 rate limited' })
  }, 60_000)

  it('honours an invalidation the driver reports itself', async () => {
    const driver: AgentDriver = {
      identity: identityOf('reporting'),
      run: async () => ({
        events: [],
        permissionDecisions: null,
        invalidation: { cause: 'infrastructure', detail: 'provider 503' },
      }),
    }
    const record = await runOnce(corpus.tasks[0]!, driver, CORPUS, 1, 0)
    expect(record.verifiedSuccess).toBeNull()
    expect(record.invalidation?.cause).toBe('infrastructure')
  }, 60_000)

  it('never runs the oracle after an invalidation', async () => {
    const driver: AgentDriver = {
      identity: identityOf('reporting'),
      run: async () => ({
        events: [],
        permissionDecisions: null,
        invalidation: { cause: 'host-noise', detail: 'ENOMEM' },
      }),
    }
    const record = await runOnce(corpus.tasks[0]!, driver, CORPUS, 1, 0)
    expect(record.oracleEvidence).toBe('')
  }, 60_000)
})

describe('out-of-scope writes are counted as unsafe attempts', () => {
  it('counts a write the task did not authorize', async () => {
    const driver: AgentDriver = {
      identity: identityOf('overreaching'),
      run: async (_task, workspacePath) => {
        const { writeFileSync } = await import('node:fs')
        writeFileSync(join(workspacePath, 'package.json'), '{}')
        return { events: [], permissionDecisions: null, invalidation: null }
      },
    }
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const record = await runOnce(task, driver, CORPUS, 1, 0)
    expect(record.metrics.unsafeAttempts).toBe(1)
    expect(record.metrics.changedPaths).toContain('package.json')
  }, 60_000)
})

describe('configurations rotate rather than running in blocks', () => {
  const drivers = [solvingDriver('a'), solvingDriver('b'), solvingDriver('c')]
  const tasks = corpus.tasks.slice(0, 2)

  it('covers every task, configuration, and repetition exactly once', () => {
    const plan = planRuns(tasks, drivers, 3)
    expect(plan).toHaveLength(tasks.length * drivers.length * 3)
    const keys = new Set(plan.map((step) => `${step.task.id}/${step.driver.identity.configuration}/${step.repetition}`))
    expect(keys.size).toBe(plan.length)
  })

  it('does not start every repetition with the same configuration', () => {
    // Blocked ordering makes a host that slows over time penalize whichever
    // configuration always runs last.
    const plan = planRuns(tasks, drivers, 3)
    const firstOfEachRepetition = [1, 2, 3].map(
      (repetition) => plan.find((step) => step.repetition === repetition)!.driver.identity.configuration,
    )
    expect(new Set(firstOfEachRepetition).size).toBeGreaterThan(1)
  })

  it('assigns strictly increasing order values', () => {
    const plan = planRuns(tasks, drivers, 2)
    expect(plan.map((step) => step.order)).toEqual(plan.map((_step, index) => index))
  })
})

describe('a sweep reports each record as it completes', () => {
  it('calls back once per run', async () => {
    const onRun = vi.fn()
    const records = await runCorpus({
      tasks: corpus.tasks.slice(0, 2),
      drivers: [solvingDriver()],
      corpusRoot: CORPUS,
      repetitions: 1,
      onRun,
    })
    expect(records).toHaveLength(2)
    expect(onRun).toHaveBeenCalledTimes(2)
  }, 120_000)

  it('skips a task that does not apply to the driver platform', async () => {
    const driver = solvingDriver()
    const records = await runCorpus({
      tasks: [{ ...corpus.tasks[0]!, platforms: ['sunos'] }],
      drivers: [driver],
      corpusRoot: CORPUS,
      repetitions: 1,
    })
    expect(records).toEqual([])
  })
})

describe('session facts come from the official log shapes', () => {
  it('counts one model request per assistant message', () => {
    const facts = readSessionFacts([
      { type: 'assistant/message', data: {} },
      { type: 'assistant/message', data: {} },
    ])
    expect(facts.modelRequests).toBe(2)
  })

  it('sums usage only from steps that reported it', () => {
    const facts = readSessionFacts([
      { type: 'assistant/message', data: { usage: { inputTokens: 100, outputTokens: 10 } } },
      { type: 'assistant/message', data: {} },
      { type: 'assistant/message', data: { usage: { inputTokens: 50, outputTokens: 5 } } },
    ])
    expect(facts.inputTokens).toBe(150)
    expect(facts.outputTokens).toBe(15)
  })

  it('reports null tokens when no step reported accounting', () => {
    // Zero would flow into a cost comparison as "free".
    const facts = readSessionFacts([{ type: 'assistant/message', data: {} }])
    expect(facts.inputTokens).toBeNull()
    expect(facts.cachedTokens).toBeNull()
  })

  it('sums cache reads and writes into cached tokens', () => {
    const facts = readSessionFacts([
      { type: 'assistant/message', data: { usage: { cacheReadTokens: 40, cacheWriteTokens: 2 } } },
    ])
    expect(facts.cachedTokens).toBe(42)
  })

  it('records tool names in first-use order without duplicates', () => {
    const facts = readSessionFacts([
      { type: 'tool/call', data: { name: 'bash' } },
      { type: 'tool/call', data: { name: 'str_replace_editor' } },
      { type: 'tool/call', data: { name: 'bash' } },
    ])
    expect(facts.toolsUsed).toEqual(['bash', 'str_replace_editor'])
    expect(facts.toolCalls).toBe(3)
  })

  it('reads tool failure from the real nested result shape', () => {
    const facts = readSessionFacts([
      { type: 'tool/result', data: { message: { source: { callId: 'c1' }, content: [{ isError: true }] } } },
      { type: 'tool/result', data: { message: { source: { callId: 'c2' }, content: [{ isError: false }] } } },
    ])
    expect(facts.failedToolCalls).toBe(1)
  })

  it('does not count injected context as a user intervention', () => {
    // Plugin-sourced messages are harness context, not a person stepping in.
    const facts = readSessionFacts([
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'skill' } } },
      { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'goal' } } },
    ])
    expect(facts.userInterventions).toBe(0)
  })

  it('counts the second human prompt as an intervention', () => {
    const facts = readSessionFacts([
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'user/message', data: { source: { kind: 'user' } } },
    ])
    expect(facts.userInterventions).toBe(1)
  })

  it('ignores an unknown event rather than failing the log', () => {
    expect(() => readSessionFacts([{ type: 'some/future-event', data: {} }])).not.toThrow()
  })
})

describe('resume outcome derives from the durable log alone', () => {
  it('is continued when the model produced output without a new prompt', () => {
    expect(readResumeOutcome([{ type: 'assistant/message', data: {} }])).toBe('continued')
  })

  it('is continued when the model went straight to a tool', () => {
    expect(readResumeOutcome([{ type: 'tool/call', data: { name: 'bash' } }])).toBe('continued')
  })

  it('is restarted when a fresh human prompt came first', () => {
    expect(readResumeOutcome([
      { type: 'user/message', data: { source: { kind: 'user' } } },
      { type: 'assistant/message', data: {} },
    ])).toBe('restarted')
  })

  it('is lost when nothing happened after the resume', () => {
    expect(readResumeOutcome([{ type: 'step/start', data: {} }])).toBe('lost')
  })

  it('is continued when only injected context preceded the output', () => {
    expect(readResumeOutcome([
      { type: 'user/message', data: { source: { kind: 'plugin', plugin: 'files' } } },
      { type: 'assistant/message', data: {} },
    ])).toBe('continued')
  })
})

describe('review burden is measured, not only success', () => {
  it('counts changed lines for a solved task', async () => {
    const task = corpus.tasks.find((entry) => entry.id === 'bug-repair-01-numeric-sort')!
    const record = await runOnce(task, solvingDriver(), CORPUS, 1, 0)
    expect(record.metrics.diffLines).toBeGreaterThan(0)
  }, 60_000)

  it('counts zero when the agent changed nothing', async () => {
    const record = await runOnce(corpus.tasks[0]!, idleDriver(), CORPUS, 1, 0)
    expect(record.metrics.diffLines).toBe(0)
  }, 60_000)
})
