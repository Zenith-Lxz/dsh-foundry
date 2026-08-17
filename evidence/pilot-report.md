# Coding evaluation

corpus version 3 · schema 1 · generated 2026-08-17T02:03:16.139Z

## Corpus coverage is incomplete

- corpus has 5 tasks, below the required 45
- category repository-navigation has 0 tasks, below the required 5
- category multi-file-feature has 0 tasks, below the required 5
- category refactoring has 0 tasks, below the required 5
- category failing-test-diagnosis has 0 tasks, below the required 5
- category long-session-resume has 0 tasks, below the required 5
- category git-diff-review has 0 tasks, below the required 5
- category platform-shell-behavior has 0 tasks, below the required 5
- category workspace-discipline has 0 tasks, below the required 5

## Same-model lane

Identical model route, prompt, permissions, workspace revision, platform, timeout, and oracle.
Differences here are attributable to composition.

configuration | platform | valid runs | verified | median time | median requests | median tokens | unsafe
--- | --- | --- | --- | --- | --- | --- | ---
daily-lean | darwin | 5 | 80.0% | 19.4s | 5 | 9117 | 0
standard | darwin | 5 | 80.0% | 18.2s | 4 | 9801 | 0

## Adaptive promotion

Promotion is UNDECIDED — the evidence required by the rule does not exist:

- darwin has results, but no adaptive configuration was evaluated against daily
- no results for win32
- deterministic suite unrun or failed on win32

Daily mode remains the default. This is not a negative result about adaptive; it is the absence of one.

## Limitations

- No win32 results: behavior on that platform is unevaluated, not equivalent.
- 10 configuration/task pairs ran fewer than the required repetitions; their rates are not stable estimates.
- Oracles verify stated success conditions; they do not assess code quality, maintainability, or review burden.
