# Daily mode observed on a real coding task

Recorded 2026-08-15, macOS 26.5.2 arm64. Runtime `@deepseek-ai/dsh@0.1.0-rc.6`, profile `daily-headless`.

This is a **single observation per condition**, not an evaluation. The corpus, repetition, and metrics required by `specs/coding-evaluation` do not exist yet, so nothing here supports a comparative or performance claim.

## Task

A git repository with `AGENTS.md` (Node ESM, no dependencies, JSDoc required, `node:test`), a failing test covering only exact versions, and no implementation. The agent was asked to implement `satisfies(version, range)` for exact, caret, and tilde ranges, follow `AGENTS.md`, and report what it ran.

## The daily section reached the model

Confirmed by decoding the durable session log and reading the `request/header` event: the assembled system prompt contains the daily instructions verbatim. Mode isolation is therefore observable in the official record, not only in unit tests.

## Observed behavior maps to the instructions

| Tool call | Instruction it satisfies |
|---|---|
| `cat AGENTS.md` before editing | read the applicable repository instructions |
| `git log` + `git status` before editing | inspect the change state you will affect |
| `npm test` | prefer the project's own commands |
| `git diff --stat && git diff` after | inspect the diff |
| no commit, `git status` shows only the new file | a coding request does not authorize commit |

## A real defect, and the instruction change that closed it

**First run** produced range matching with **no lower bound**. Its own JSDoc described "the left-most non-zero digit"; the code compared major only.

| case | result | expected |
|---|---|---|
| `satisfies('1.0.0', '^1.2.3')` | `true` | `false` |
| `satisfies('1.2.2', '^1.2.3')` | `true` | `false` |
| `satisfies('0.9.0', '^0.2.3')` | `true` | `false` |
| `satisfies('1.2.0', '~1.2.3')` | `true` | `false` |

**4 of 9 boundary cases wrong — and the agent reported success.** It had run `npm test` (which covers only exact versions) plus a self-authored check whose cases it chose itself, all happy paths. The verification could not have failed.

The daily instructions said to verify with project-owned checks, but said nothing about the case where those checks *do not cover the change*. That paragraph was added:

> Where those checks do not cover what you changed, say so and test the boundaries rather than the happy path: the first and last accepted value, one just outside each end, and whatever your documentation claims. A check that only exercises what you just wrote is not evidence.

**Second run, identical task and prompt: 0 of 9 wrong.** The self-authored check changed shape in a directly traceable way — its case labels became `below` / `min` / `mid` / `max`, and it added the `^0.2.3` and `^0.0.3` cases its documentation claimed:

```js
ne('^1.2.3 below', satisfies('1.2.2','^1.2.3'))   // the exact case that failed before
e ('^1.2.3 min',   satisfies('1.2.3','^1.2.3'))
ne('^1.2.3 max',   satisfies('2.0.0','^1.2.3'))
```

The implementation also improved structurally: an explicit lower bound, correct leftmost-non-zero caret semantics, and decomposition into `parse` / `compare` / `inCaret`.

**What this does and does not show.** One task, one run per condition, one model. It demonstrates that the standing instructions reach the model and change observable behavior on this task. It is not evidence of a general improvement rate, and it is not a comparison with any other product.

## Cost of the change

The section grew past its 300-token guard (393 estimated). The rest of the text was compressed and the budget was raised once, to 360, with the reason recorded at the constant: the paragraph earned its space by closing a defect that shipped silently.

## A design gap this surfaced

Daily decoration keys on the official preset identity, and **the headless composition records no preset at all** — it builds agents directly rather than from a preset, so `resolveSessionPreset` answers `undefined`. The decorator correctly declined, and the first two runs carried no daily section.

The fix is a `decorateWhenNoPreset` option, **off by default**. In a shared profile the user switches presets, so an unresolved preset must stay undecorated; a single-purpose profile like `daily-headless` is the profile-level selection and opts in explicitly. This is recorded against task 2.4: the headless daily Bundle must carry that option, and must also mount the preset roster if it wants preset-keyed behavior.

## Regression at the time of recording

194 tests passed (9 files), `gate:coupling` clean, typecheck clean, contract probe 16 pass / 0 fail / 2 need a live host, `qualify:daily` 10/10.
