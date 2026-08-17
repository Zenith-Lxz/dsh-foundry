import { describe, expect, it, vi } from 'vitest'
import { compareVersions, decide, describeDecision, satisfiesRange, type Candidate } from '../src/plan.ts'

const RANGE = '>=0.1.0-rc.6 <0.2.0'

/**
 * Build a candidate.
 * @param overrides - Fields to override.
 * @returns The candidate.
 */
function candidateOf(overrides: Partial<Candidate> = {}): Candidate {
  return {
    target: 'harness',
    packageName: '@deepseek-ai/dsh',
    current: '0.1.0-rc.6',
    available: '0.1.0-rc.7',
    ...overrides,
  }
}

/** A probe reporting a healthy candidate. */
const healthy = vi.fn(async () => ({ missing: [], failure: null }))

describe('version comparison handles the prerelease form the Harness uses', () => {
  it.each([
    ['0.1.0', '0.1.0', 0],
    ['0.1.1', '0.1.0', 1],
    ['0.1.0', '0.2.0', -1],
    ['0.1.0-rc.7', '0.1.0-rc.6', 1],
    ['0.1.0', '0.1.0-rc.9', 1],
    ['0.1.0-rc.6', '0.1.0', -1],
  ])('%s vs %s', (left, right, expected) => {
    expect(Math.sign(compareVersions(left, right))).toBe(expected)
  })

  it('orders rc.10 after rc.9 rather than before it', () => {
    // String comparison puts "10" before "9"; the numeric parts must not be
    // compared as text or an update would look like a downgrade.
    expect(compareVersions('0.1.0-rc.10', '0.1.0-rc.9')).toBeGreaterThan(0)
  })
})

describe('the accepted range is respected', () => {
  it.each(['0.1.0-rc.6', '0.1.0-rc.9', '0.1.5', '0.1.99'])('accepts %s', (version) => {
    expect(satisfiesRange(version, RANGE)).toBe(true)
  })

  it.each(['0.1.0-rc.5', '0.2.0', '1.0.0'])('rejects %s', (version) => {
    expect(satisfiesRange(version, RANGE)).toBe(false)
  })

  it('rejects when the range cannot be parsed, rather than accepting anything', () => {
    // Treating an unparsed range as permissive would let an untested major
    // version install itself.
    expect(satisfiesRange('0.1.0', 'latest')).toBe(false)
  })
})

describe('a Harness candidate is probed before it is offered', () => {
  it('offers a healthy in-range candidate and records the rollback target', async () => {
    const decision = await decide(candidateOf(), RANGE, healthy)
    expect(decision.offered).toBe(true)
    if (decision.offered) expect(decision.rollbackTo).toBe('0.1.0-rc.6')
  })

  it('refuses a candidate missing an extension point, naming it', async () => {
    const probe = async () => ({ missing: ['agent/pre-step', 'Tools.schemas'], failure: null })
    const decision = await decide(candidateOf(), RANGE, probe)
    expect(decision.offered).toBe(false)
    if (!decision.offered) {
      expect(decision.reason.kind).toBe('missing-extension-points')
      expect(describeDecision(decision)).toMatch(/agent\/pre-step/)
    }
  })

  it('says refusing is the correct outcome, not a failure of the update', async () => {
    const probe = async () => ({ missing: ['ctx.inputTriggers'], failure: null })
    const decision = await decide(candidateOf(), RANGE, probe)
    expect(describeDecision(decision)).toMatch(/forked distribution cannot make/)
  })

  it('refuses when the probe itself could not run', async () => {
    const probe = async () => ({ missing: [], failure: 'scratch profile would not compose' })
    const decision = await decide(candidateOf(), RANGE, probe)
    expect(decision.offered).toBe(false)
    if (!decision.offered) expect(decision.reason.kind).toBe('qualification-failed')
  })

  it('refuses when the probe throws, rather than treating a crash as a pass', async () => {
    const decision = await decide(candidateOf(), RANGE, async () => {
      throw new Error('network unreachable')
    })
    expect(decision.offered).toBe(false)
    if (!decision.offered) expect(decision.reason.kind).toBe('qualification-failed')
  })

  it('never probes a version outside the range', async () => {
    const probe = vi.fn(async () => ({ missing: [], failure: null }))
    await decide(candidateOf({ available: '0.2.0' }), RANGE, probe)
    expect(probe).not.toHaveBeenCalled()
  })

  it('does not offer a version that is not newer', async () => {
    const decision = await decide(candidateOf({ available: '0.1.0-rc.6' }), RANGE, healthy)
    expect(decision.offered).toBe(false)
    if (!decision.offered) expect(decision.reason.kind).toBe('not-newer')
  })
})

describe('distribution updates skip the Harness range and probe', () => {
  it('offers a newer distribution version without probing', async () => {
    const probe = vi.fn(async () => ({ missing: [], failure: null }))
    const decision = await decide(
      candidateOf({ target: 'distribution', packageName: '@dsh-foundry/daily-bundle', current: '0.1.0', available: '0.2.0' }),
      RANGE,
      probe,
    )
    expect(decision.offered).toBe(true)
    expect(probe).not.toHaveBeenCalled()
  })

  it('still refuses a distribution version that is not newer', async () => {
    const decision = await decide(
      candidateOf({ target: 'distribution', current: '0.2.0', available: '0.1.0' }),
      RANGE,
      healthy,
    )
    expect(decision.offered).toBe(false)
  })
})

describe('the user is told what an update actually does', () => {
  it('says the application is not re-downloaded', async () => {
    const decision = await decide(candidateOf(), RANGE, healthy)
    expect(describeDecision(decision)).toMatch(/not re-downloaded/)
  })

  it('names the rollback target', async () => {
    const decision = await decide(candidateOf(), RANGE, healthy)
    expect(describeDecision(decision)).toMatch(/Roll back to 0\.1\.0-rc\.6/)
  })

  it('explains an out-of-range refusal in terms of testing, not permission', async () => {
    const decision = await decide(candidateOf({ available: '0.2.0' }), RANGE, healthy)
    expect(describeDecision(decision)).toMatch(/has not been tested against this distribution/)
  })
})
