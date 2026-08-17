# macOS darwin-arm64 acceptance record

Generated 2026-08-17T08:55:07.661Z by `scripts/acceptance-matrix.ts`.

**Scope: this host only.** Nothing here is evidence for Windows, which has never been
run on real hardware. See `STATUS.md`.

## Identity

| Field | Value |
| --- | --- |
| Product | DSH Foundry |
| Bundle id | `io.github.zenith-lxz.dsh-foundry` |
| Repository | https://github.com/Zenith-Lxz/dsh-foundry |
| Companion version | 0.1.0 |
| Official DSH | 0.1.0-rc.6 (accepted `>=0.1.0-rc.6 <0.2.0`) |
| Electron | 43.4.0 |
| Staged Node | 24.18.0 |
| Stage nativeComplete | true |
| Profile | `desktop` over @deepseek-ai/dsh-base → @deepseek-ai/dsh-web-app → @dsh-foundry/bundle |

## Artifact

Sizes exclude symlinks, so they match what a download carries.

| Artifact | Size | SHA-256 |
| --- | --- | --- |
| `DSH Foundry.app` (tree) | 720.8 MiB | — |
| `Contents/MacOS/DSH Foundry` | 33.2 KiB | `1af684f056a8eb13e49fbd677072e437316086b076e3b9b92de3ddb343edc5b1` |

**Unsigned.** macOS Gatekeeper will quarantine it; this build is not notarized.

## Companion packages shipped inside the bundle

| Package | Size | SHA-256 |
| --- | --- | --- |
| `dsh-foundry-bundle-0.1.0.tgz` | 2.2 KiB | `8ff0c7e761f1a9fb468ea0c804bd0e2b5a6cb216ea7ed6f949e3cfddcfa77798` |
| `dsh-foundry-daily-agent-0.1.0.tgz` | 10.1 KiB | `fbd025d9edb1461f5c893b40fe554e85b2b538749a655cf4b573dcb25af3d1f0` |
| `dsh-foundry-daily-bundle-0.1.0.tgz` | 1.8 KiB | `c92838b788915accd5b043be24ee53e79ecc13e0589667dd71acf649f4335f5a` |
| `dsh-foundry-daily-contract-0.1.0.tgz` | 4.5 KiB | `7daf9d442fe1c988e98f9b4d75d2cae04bfa9f9400b184b705aabf49a12a2b2c` |
| `dsh-foundry-daily-workbench-0.1.0.tgz` | 51.0 KiB | `d2caf97c9fa60dc24d357492f5a4724679ca2a7a84b55467020ed4571a3d9771` |
| `dsh-foundry-layout-0.1.0.tgz` | 9.4 KiB | `5239a08d4ec789bc1c35f0ca262045bd7b9ec5dc3d85225b94b4e8158a5a9a89` |
| `dsh-foundry-native-0.1.0.tgz` | 2.5 KiB | `179e57dd8eb4fb377fc66e9feed670779098479a0f73c1cb3c6cacb7b76c3069` |
| `dsh-foundry-plugin-governance-0.1.0.tgz` | 16.7 KiB | `e527f5a0b510c71fc8174e8a346a0db21366ea00766452796ba30a75dd89733b` |

## How to reproduce this record

```bash
pnpm install
pnpm run mechanics                 # every release gate
pnpm run package:darwin-arm64     # produce the artifact
pnpm run smoke:app                 # exercise the packaged .app in a clean environment
pnpm run acceptance:darwin         # regenerate this file
```

Gate results are recorded separately in `mechanics.md`; the packaged smoke writes its own
log path on each run. Interactive findings are in `../acceptance-2026-08-17/`.

