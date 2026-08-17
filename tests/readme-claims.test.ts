/**
 * The READMEs state only what the evidence holds.
 *
 * Both once carried a table of "40 tasks x 3 repetitions x 3 configurations =
 * 360 runs" with per-configuration success rates and token medians. No such
 * data exists in this repository: `evidence/evaluation.json` records zero runs,
 * and the only retained comparison is a five-task pilot. The figures were
 * precise, plausible, and unsupported — the worst combination a user-facing
 * claim can have.
 *
 * The checks are deliberately **independent of the document's structure**. An
 * earlier version located a section by its heading and broke the moment the
 * README was reorganised for readability, which puts a guard in tension with
 * editing the thing it guards. What matters is not where the claims live but
 * that measurement-shaped figures are backed and the three standing disclaimers
 * survive a rewrite.
 * @module tests/readme-claims.test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const READMES = ['README.md', 'README.en.md'] as const
const evidence = readFileSync(join(ROOT, 'evidence', 'pilot-report.md'), 'utf8')

/** Digits only, so `9 801` and `9801` compare equal across formatting. */
const digits = (value: string): string => value.replace(/[^0-9]/g, '')

/**
 * Figures shaped like a measurement taken from a run.
 *
 * A percentage, a duration, or a four-plus digit count is the form an
 * evaluation result takes. Version numbers, port numbers, pixel widths, and
 * counts of gates or tests are project facts rather than measurements, and are
 * excluded by shape rather than by an allowlist that would need maintaining.
 */
function measurementFigures(text: string): string[] {
  const percentages = [...text.matchAll(/\b\d+\.\d+\s?%/g)].map((match) => match[0])
  const durations = [...text.matchAll(/\b\d+\.\d+\s?s\b/g)].map((match) => match[0])
  const counts = [...text.matchAll(/\b\d[\d\s]{3,}\d\b/g)].map((match) => match[0])
  return [...percentages, ...durations, ...counts]
}

describe.each(READMES)('%s', (file) => {
  const text = readFileSync(join(ROOT, file), 'utf8')

  it('quotes no measurement-shaped figure that the evidence does not contain', () => {
    const backing = digits(evidence)
    for (const figure of measurementFigures(text)) {
      // Substring over digits: `18.2` here matches `18.2s` in the report, and a
      // value the report never produced matches nothing.
      expect(backing, `${file}: ${figure} appears in no retained evidence`).toContain(digits(figure))
    }
  })

  it('cites the evidence file wherever it discusses the evaluation', () => {
    // The corpus may be described without quoting results, but the moment a
    // result is mentioned the reader needs somewhere to check it.
    if (!/UNDECIDED|promotion/i.test(text)) return
    expect(text).toContain('evidence/pilot-report.md')
  })

  it('claims no performance advantage', () => {
    expect(text).toMatch(/不作任何声明|No claim is made about coding efficiency/)
    expect(text).toMatch(/UNDECIDED/)
  })

  it('states that no competitor comparison was run', () => {
    expect(text).toMatch(/Claude Code/)
    expect(text).toMatch(/从未与|No comparison with/)
  })

  it('says the installers are unsigned', () => {
    expect(text).toMatch(/未签名|unsigned/)
  })
})

describe('the guard itself', () => {
  it('recognises an evaluation figure and ignores a project fact', () => {
    expect(measurementFigures('verified 91.7% of tasks')).toContain('91.7%')
    expect(measurementFigures('median 18.2s per run')).toContain('18.2s')
    expect(measurementFigures('11 490 tokens')).toContain('11 490')
    // Versions, gate counts, and test counts are not measurements of a run.
    expect(measurementFigures('DSH 0.1.0-rc.6, 15 / 15 gates, Node 24.18.0')).toEqual([])
  })

  it('would reject the unsupported table that shipped once', () => {
    const backing = digits(evidence)
    for (const figure of measurementFigures('| 110/120 (91.7%) | 11 490 |')) {
      expect(backing).not.toContain(digits(figure))
    }
  })
})
