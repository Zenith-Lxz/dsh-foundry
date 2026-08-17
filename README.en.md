# DSH Foundry

[中文](README.md) · [Releases](https://github.com/Zenith-Lxz/dsh-foundry/releases)

**A zero-patch desktop distribution of the official DeepSeek Harness.**

No Node install. No terminal setup. No upstream fork.  
Open the app — runtime, release, and package manager ship inside the bundle.

> **Not a DeepSeek product.** Official DSH belongs to DeepSeek. This project consumes it as a pinned external dependency and wraps a real desktop shell around it.

---

## Download

| Platform | Installer | Status |
| --- | --- | --- |
| **macOS Apple Silicon** | [`.dmg`](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest) | Qualified |
| **Windows x64** | [`.exe` Setup](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest) | Build candidate\* |

\* The Windows package builds. It has **never run on real Windows hardware** and is not an accepted platform.

Builds are **unsigned and not notarized**. On macOS, first launch: right-click → Open. On Windows, SmartScreen will warn — More info → Run anyway.

---

## What you get

Official DSH is an everything-is-a-plugin agent framework. Foundry adds four things **without changing a line of its source**:

| | |
| --- | --- |
| **A real desktop app** | macOS `.app` / Windows installer, system theme |
| **A repository workbench** | `@file` refs, bounded search, **read-only** Git review, verification evidence |
| **Plugin provenance** | Who shipped it, was it reviewed, what breaks if you turn it off |
| **An evaluation frame** | 45-task corpus + two-way oracles; reports that say "unrun" when they are |

**No fork. No vendoring. No patches. No deep imports. No monkey patches.**  
Upstream ships; we inherit. Merge debt stays zero.

```bash
pnpm run gate:coupling   # enforced, not aspirational
```

---

## 30-second start (from source)

```bash
pnpm install
pnpm run bundle
pnpm run build:icon
pnpm run package:darwin-arm64
open "release/darwin-arm64/DSH Foundry-darwin-arm64/DSH Foundry.app"
```

Plugins only, no desktop shell:

```bash
dsh plugin --profile <name> add @dsh-foundry/daily-bundle
```

---

## Design in one screen

- **Business traffic stays on official transports** (HTTP / WebSocket / Typert). Electron IPC is windows, directory pick, external links, lifecycle — nothing else.
- **The bridge is a closed, frozen object.** No `invoke(channel)`. No raw `ipcRenderer`.
- **Paths are opaque native strings.** Windows drive letters and UNC are never "normalized" into POSIX.
- **Misconfiguration fails loud** at the earliest resolvable point. No silent dead controls.

---

## Evidence (reproducible)

| Check | Result |
| --- | --- |
| `pnpm run mechanics` | **15 / 15** |
| `pnpm run smoke:app` | **19 / 19** |
| `pnpm run verify:window` | **16 / 16** |
| `npx vitest run` | **1134 passed / 51 files** |
| Upstream checkout | **0** tracked changes |

```bash
pnpm run mechanics
pnpm run smoke:app
pnpm run verify:window
pnpm run acceptance:darwin
```

---

## Measured results

**No performance advantage is claimed.**

Every figure comes from [`evidence/pilot-report.md`](evidence/pilot-report.md) (raw samples in `evidence/pilot-runs.json`). Nothing is quoted from a run this repository does not retain — `tests/readme-claims.test.ts` fails the build otherwise.

The corpus is designed for 45 tasks / 9 categories. The only same-model comparison on record is a **pilot**: 5 tasks × 1 rep × macOS arm64 only.

| configuration | platform | valid runs | verified | median time | median tokens |
| --- | --- | --- | --- | --- | --- |
| official Standard | darwin | 5 | 80.0% | 18.2s | 9 801 |
| daily-lean | darwin | 5 | 80.0% | 19.4s | 9 117 |

**UNDECIDED.** Promotion needs the full corpus, 3 reps, both platforms. A 1.4s / 684-token gap across 5 single runs is noise.  
**No comparison with Claude Code, Codex, or any other DSH distribution has ever been run.**

---

## Develop from source

```bash
pnpm install
pnpm run lint && pnpm run typecheck && pnpm run test
pnpm run bundle
pnpm run package:darwin-arm64   # or package:win32-x64
pnpm run installer darwin-arm64 # → release/installer/*.dmg
pnpm run installer win32-x64    # → release/installer/*.exe
```

| Need | Version |
| --- | --- |
| Node | ≥ 24.18.0 (pinned in `mise.toml`) |
| pnpm | 11.7.0 |
| Official DSH | `0.1.0-rc.6` (range `>=0.1.0-rc.6 <0.2.0`) |

```
apps/desktop/       Electron main · preload · window policy · process supervision
packages/           adapter · bridge contract · layout/native plugins · workbench · eval
scripts/            staging · gates · packaging · installers
corpus/             evaluation corpus
assets/             icon sources
```

---

## Known limits

- Windows: **build candidate**, not hardware-accepted
- Default coding configuration: **has not passed promotion**
- Installers: **unsigned / not notarized**
- `will-navigate` cross-origin block: unverified (bridge authorizes on origin; blank documents are `null` and refused)

---

## Licence

MIT · No affiliation with DeepSeek
