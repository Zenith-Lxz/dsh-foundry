<div align="center">
  <img src="assets/icon-256.png" width="120" alt="DSH Foundry">

# DSH Foundry

**A zero-patch desktop distribution of the official DeepSeek Harness.**

[![License](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Release](https://img.shields.io/github/v/release/Zenith-Lxz/dsh-foundry)](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest)
[![Platform](https://img.shields.io/badge/Platform-macOS%20%7C%20Windows-lightgrey.svg)](#download)
[![Upstream diff](https://img.shields.io/badge/Upstream%20diff-0-brightgreen.svg)](#why-not-a-fork)

[中文](README.md) · [Download](#download) · [Features](#features) · [Build](#building-from-source) · [License](#license)
</div>

## Introduction

The official DeepSeek Harness is an everything-is-a-plugin agent framework with a web interface. DSH Foundry packages it as a real desktop application: the Node runtime, the DSH release, and the package manager are all sealed inside the installer. No prerequisites, no terminal setup — the app provisions its own profile on first launch.

This project does **not fork or modify official source**. It composes only through public extension points, so upstream improvements are inherited for free.

> Official DSH belongs to DeepSeek. This project has no affiliation with DeepSeek.

<p align="center">
  <img src="assets/screenshot-main.png" width="80%" alt="DSH Foundry">
</p>

## Download

| Platform | Installer |
| --- | --- |
| macOS (Apple Silicon) | [.dmg](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest) |
| Windows (x64) | [.exe Setup](https://github.com/Zenith-Lxz/dsh-foundry/releases/latest) |

Builds are **unsigned and not notarized**. On macOS, right-click → Open the first time. On Windows, choose *More info → Run anyway* if SmartScreen warns.

Plugins only, no desktop app:

```bash
dsh plugin --profile <name> add @dsh-foundry/daily-bundle
```

## Features

- **Desktop shell**: follows the system theme, with a macOS traffic-light safe area, Windows caption controls, and a native directory picker.
- **Repository workbench**: `@file` references (inserting a path, never file contents), bounded search, and **read-only** Git review (structurally incapable of staging, committing, or rewriting history), with session-scoped context and background jobs.
- **Plugin provenance**: source, version, profile, bundle, Foundry-qualified status, and disable impact for every plugin. Provenance comes only from declared metadata; missing data reads as Unknown.
- **Evaluation framework**: a 45-task corpus across 9 categories, two-way verified oracles, and paired bootstrap statistics.

> Plugins run with your user authority. Approval prompts for model tool calls do **not** apply to plugin code or MCP servers.

## Why not a fork

A patching distribution merges upstream on every release. This project only composes: **no fork, no vendoring, no patches, no deep imports, no monkey patching** — zero tracked changes in the upstream checkout.

```bash
pnpm run gate:coupling   # release gate: rejects local source paths and undeclared subpaths
```

All business traffic travels the official transports (HTTP / WebSocket / Typert); Electron IPC carries only windows, directory picking, external links, and lifecycle — workbench modules must not import the desktop bridge.

## Building from source

```bash
pnpm install
pnpm run bundle
pnpm run build:icon
pnpm run package:darwin-arm64    # or package:win32-x64
pnpm run installer darwin-arm64  # produces release/installer/*.dmg
pnpm run installer win32-x64     # produces release/installer/*.exe
```

| Requirement | Version |
| --- | --- |
| Node | ≥ 24.18.0 (pinned in `mise.toml`) |
| pnpm | 11.7.0 |
| Official DSH | `0.1.0-rc.6` (range `>=0.1.0-rc.6 <0.2.0`, see [compatibility.json](compatibility.json)) |

Layout:

```text
apps/desktop/     Electron main, preload, window policy
packages/         adapter, bridge contract, layout and native plugins, workbench, governance, eval
scripts/          staging, gates, packaging, installers
corpus/           evaluation corpus
assets/           icons
```

## Status

macOS Apple Silicon is the qualification target and is packaged and accepted. Windows x64 is a build candidate that installs and runs on real hardware; the full acceptance matrix is still pending.

| Check | Result |
| --- | --- |
| `pnpm run mechanics` | 15 / 15 |
| `pnpm run smoke:app` | 19 / 19 |
| `pnpm run verify:window` | 16 / 16 |
| `npx vitest run` | 1134 passed, 51 files |

**No claim is made about coding efficiency**: the corpus is designed at 45 tasks, but the only comparison on record is a 5-task pilot and promotion is **UNDECIDED** (see [`evidence/pilot-report.md`](evidence/pilot-report.md); `tests/readme-claims.test.ts` rejects any figure the evidence does not support). **No comparison with** Claude Code, Codex, or any other DSH distribution has ever been run.

## License

[MIT](LICENSE). Not affiliated with DeepSeek. The whale mark in the app icon is taken from the upstream Harness and is DeepSeek's trademark ([details](assets/README.md)).
