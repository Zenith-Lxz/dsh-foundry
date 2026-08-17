/**
 * Every measurement the READMEs state is backed by retained evidence.
 *
 * Both READMEs once carried a table of "40 tasks × 3 repetitions × 3
 * configurations = 360 runs" with per-configuration success rates and token
 * medians. No such data exists in this repository: `evidence/evaluation.json`
 * records zero runs, and the only retained comparison is a five-task pilot.
 * The figures were precise, plausible, and unsupported — the worst combination
 * a user-facing claim can have.
 *
 * A prose rule would not have caught it, so the numbers are checked against the
 * evidence file the READMEs cite.
 * @module tests/readme-claims.test
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = fileURLToPath(new URL('..', import.meta.url))
const pilot = readFileSync(join(ROOT, 'evidence', 'pilot-report.md'), 'utf8')

/** Digits only, so `9 801` and `9801` compare equal across formatting. */
const digits = (value: string): string => value.replace(/[^0-9]/g, '')

/**
 * Numbers appearing in a README's measured-results section.
 * @param file - README filename.
 * @returns The section text and the numeric tokens inside its table rows.
 */
function resultsSection(file: string): { text: string, numbers: string[] } {
  const readme = readFileSync(join(ROOT, file), 'utf8')
  const start = readme.search(/^## (Measured results|实测结果)$/m)
  expect(start, `${file}: no measured-results section`).toBeGreaterThan(-1)
  const rest = readme.slice(start + 1)
  const end = rest.search(/^## /m)
  const text = end === -1 ? rest : rest.slice(0, end)
  const numbers = [...text.matchAll(/^\|[^|]*\|[^\n]*$/gm)]
    .flatMap((row) => [...row[0].matchAll(/\d[\d\s.,]*\d|\d/g)].map((m) => m[0].trim()))
  return { text, numbers }
}

describe.each(['README.md', 'README.en.md'])('%s states only what the evidence holds', (file) => {
  it('cites the evidence file its numbers come from', () => {
    expect(resultsSection(file).text).toContain('evidence/pilot-report.md')
  })

  it('quotes no figure absent from that evidence', () => {
    const { numbers } = resultsSection(file)
    expect(numbers.length, 'the table should carry measurements').toBeGreaterThan(4)
    const backing = digits(pilot)
    for (const value of numbers) {
      // Substring over digits: `18.2` in the README matches `18.2s` in the
      // report, and a value the report never produced matches nothing.
      expect(backing, `${file}: ${value} appears in no retained evidence`).toContain(digits(value))
    }
  })

  it('claims no performance advantage', () => {
    const { text } = resultsSection(file)
    expect(text).toMatch(/No performance advantage is claimed|不声称任何性能优势/)
    expect(text).toMatch(/UNDECIDED/)
  })

  it('states that no competitor comparison was run', () => {
    const { text } = resultsSection(file)
    expect(text).toMatch(/Claude Code/)
  })
})
