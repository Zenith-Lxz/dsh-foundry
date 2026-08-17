# macOS arm64 packaged smoke

Task 8.1. Recorded 2026-08-15.

## Host and artifact

| Fact | Value |
|---|---|
| Host | macOS 26.5.2, Apple Silicon (arm64) |
| Artifact | `~/dsh-desktop-smoke/DeepSeek Harness.app` |
| Built from | `release/darwin-arm64/DeepSeek Harness-darwin-arm64/` |
| Bundle id | `ai.deepseek.harness.desktop` |
| Executable | `Mach-O 64-bit executable arm64` |
| Size | 805 MB |
| Signing | **unsigned by design**; signing and notarization are separate changes |
| Electron | 43.4.0 |
| Staged Node | 24.18.0 (`Contents/Resources/stage/darwin-arm64/node/bin/node`, verified `v24.18.0`) |
| Staged DSH | `@deepseek-ai/dsh@0.1.0-rc.6` |
| Stage descriptor | `nativeComplete: true`, `stagedOn: darwin-arm64` |
| Harness home | `~/dsh-desktop-smoke/harness-home` (isolated; the user had no `~/.dsh`, and none was created) |

## Launched outside both source repositories

The `.app` was copied to `~/dsh-desktop-smoke/`, which is outside both
`/Users/liuxianzhao/Documents/项目/dsh` and `/Users/liuxianzhao/Documents/项目/dsh-desktop`,
and launched from there.

The supervised child resolved entirely from inside the bundle:

```text
.../dsh-desktop-smoke/DeepSeek Harness.app/Contents/Resources/stage/darwin-arm64/node/bin/node
.../dsh-desktop-smoke/DeepSeek Harness.app/Contents/Resources/stage/darwin-arm64/runtime/node_modules/@deepseek-ai/dsh/lib/bin.js
  --profile desktop --host 127.0.0.1 --port 0
```

## Closed-resolution gates

`lsof` across all five application processes yielded 57 distinct open paths:

| Gate | Result |
|---|---|
| Paths inside the DSH source repo | **0** |
| Paths inside the companion source repo | **0** |
| Global `node` (`/usr/local`, `/opt/homebrew`, `.nvm`, mise installs) | **none** |
| Foreign-target stage (`win32-x64`) | **none** |
| Where runtime paths do resolve from | `~/dsh-desktop-smoke` (the bundle and the Harness home) |

## Behavior observed

- The desktop frame rendered with the platform title bar and the traffic-light safe area; the official sidebar, conversation hero, and composer rendered inside it.
- The bridge worked from inside the app archive: the frame only renders when `describe()` succeeds, and a double-click on the title bar performed `toggle-maximize` through `performWindowAction`.
- The maximized layout reflowed correctly and kept the traffic lights clear of content.
- Menu-bar identity read `DeepSeek Harness`, not `Electron`.

## Timing

Process launch to the owned host serving HTTP on its loopback port: **916 ms** (single measurement, not a benchmark).

## Shutdown

Closing through the window control:

```text
[dsh-desktop] shutdown clean in 48ms; surviving owned descendants: 0
```

Repeat run: `shutdown clean in 54ms; surviving owned descendants: 0`. After quit, `pgrep -lf dsh-desktop-smoke` returned no processes.

## First-run provisioning

A delivered application has no `desktop` profile on the machine, and a non-template profile name fails loud until something creates it. The application now provisions it on the first launch that needs it, through the official `dsh plugin --profile desktop add` command, using the companion tarballs and the package manager it ships.

| Launch | Result |
|---|---|
| Absent home, minimal `PATH` (`/usr/bin:/bin:/usr/sbin:/sbin`) | profile created in **23 s**; layers `dsh-base -> dsh-web-app -> @dsh-desktop/bundle`; host started |
| Second launch, same home | host process started in **530 ms**; profile manifest **not** rewritten (idempotent) |
| `open -a` with no environment variables, default `~/.dsh` | profile provisioned in **8 s**; host started; desktop frame rendered |

Two defects were found and fixed by this test rather than by inspection:

1. **`dsh plugin` needs `pnpm` on `PATH` and exits 127 without it.** A desktop-launched application inherits a minimal `PATH`, so provisioning would fail on any machine without a developer toolchain. The stage now carries `pnpm@11.7.0` plus POSIX and Windows launchers over the staged Node, and provisioning prepends them for that one subprocess. Writing the profile directly was rejected: it would bypass the very command the installation contract is defined in terms of.
2. **Provisioning ran with the Harness home as its working directory before creating it**, so the spawn failed before the command was reached. The home is now created first, and a failure reports the package manager's stdout as well as its stderr — the earlier surface showed an empty diagnostic because that manager writes its errors to stdout.

## Limits

- Idle quit only. Active-tool quit, restart, renderer crash, and host crash were not exercised here.
- No model traffic: no `DEEPSEEK_API_KEY` was configured, so the daily-programming workflow (task 7.1) is not covered by this smoke.
- Startup timing is one sample and is not the comparative performance benchmark (task 7.4), which remains unaccepted.
