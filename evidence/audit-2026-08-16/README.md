# Audit, 2026-08-16 — the state before this round of work

These screenshots are the **original failure evidence** for the audit that
started this round. They are kept unedited: several of them show defects that
have since been fixed, and deleting them would erase the record of what the
product actually did.

| File | What it shows |
| --- | --- |
| `01-first-launch.png` | The packaged application failing at first launch — `ERR_MODULE_NOT_FOUND` for `daily-workbench/lib/gateway.js`. The tarball shipped an entry whose relative import was not packed. |
| `02-current-source-launch.png` | The same build launched from source, for comparison with the packaged run. |
| `03-current-source-after-wait.png` | The source launch after waiting, showing the state was not a slow start. |
| `04-at-file-menu.png` | Typing `@` producing no menu. This was read at the time as the whole defect; it turned out to be five independent ones, and the screenshot was taken on the no-session composer. |
| `05-settings.png` | The official settings surface, unmodified by this distribution. |
| `06-plugin-settings.png` | The official plugin settings page. |
| `07-plugin-list.png` | The official plugin list — the surface that carries no provenance, which is why this distribution adds its own. |
| `08-daily-plugin-search.png` | Searching the official list for `daily`, returning nothing despite those packages being installed and running. |
| `09-native-directory-picker.png` | The native macOS directory dialog reached through the desktop bridge. |

## What became of these findings

The first-launch failure and the `@` menu are both fixed; the causes and the
checks that now prevent them are recorded in
[`docs/adr/0003-out-of-tree-remote-faces.md`](../../docs/adr/0003-out-of-tree-remote-faces.md)
and [`../acceptance-2026-08-17/at-file-resolution.md`](../acceptance-2026-08-17/at-file-resolution.md).

The empty-provenance searches in `07` and `08` are what
`packages/plugin-governance` exists to answer.
