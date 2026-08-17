# `@file` and the workbench: what was wrong and what is verified

The user reported `@` producing no menu. This records the causes found, the
checks added, and exactly what has and has not been observed working.

## Five defects, one symptom

Each hid the next; fixing any one alone changed nothing visible.

| # | Defect | Why nothing reported it |
| --- | --- | --- |
| 1 | A second copy of `dsh-typert-protocol` held the `@Remote` markers | The Gateway reads its own copy's `WeakMap`, finds no markers, and answers a bare `not found` |
| 2 | `#private` field on the Remote face | The Gateway invokes on the Cordis service proxy; the throw happens *after* dispatch succeeded |
| 3 | Client swallowed every failure into `[]` | The official reducer closes a menu whose groups are all ready-and-empty — identical to no source registered |
| 4 | Result schemas validated against hand-written fixtures | `inspectRepository` nests its overview; the schema flattened it, and both sides agreed |
| 5 | The source declared no reference `codec` | Insertion worked; the **send** rejected with `slash: no serializer for reference source "files"` and the message stayed stuck in the composer |

A fifth, found while fixing these: the Host resolved its workspace from
`process.cwd()`, which for the packaged application is the **user's home
directory**.

## What the earlier diagnosis got wrong

`docs/upstream-requests/0001` concluded the official typert generator made an
out-of-tree Remote unreachable from the browser, and the product shipped an
unavailable state citing it. The Gateway has an SRC fallback that dispatches
from the decorator markers with no generator output at all. The generator
finding is real; the blocker was not. That document is corrected.

## Verified working

Observed in a profile installed from **tarballs** (not workspace links), with
the Host launched from `/private/tmp` and the workspace at
`/private/tmp/pkgprobe2/ws` — the packaged layout, not the developer one.

- `@` opens the menu inside a live session; `@main` narrows to `src/main.ts`
- `ArrowDown` moves the selection; `aria-selected` tracks it
- `Enter` inserts a **reference chip** (`main.ts`), not file contents
- The composed message **sends**, and the recorded content is exactly
  `summarize @src/main.ts` — the placeholder replaced by the path, no file
  contents, no leftover U+FFFC
- Changes panel: branch `main`, 2 untracked entries, each attributed
  "changed outside this session — no tool call in this trajectory accounts for it"
- Plugins panel: 13 rows across 2 profiles with source, evidence, and disable
  impact; searching `daily` returns 9 of 13
- `findPaths` / `searchText` / `inspectRepository` answer over the official
  HTTP transport; an unknown session is refused by the runtime with
  `session-not-found`

## Checks added

- `verify:remotes` (release gate) — no `#private` on a Remote face; no official
  runtime import that a profile could resolve to a second copy. Its own tests
  run it against fixture packages carrying each defect.
- `smoke:app` — calls the Host over the official transport against the packaged
  `.app`: `listPlugins` for a full successful round trip, `findPaths` asserted
  to reach the official session lookup.
- `remote-contract.test.ts` — parses **produced** capability output through each
  declared schema. Reintroducing the old flattened `inspectRepository` schema
  fails it.
- `workspace-resolution.test.ts` — the root comes from the session and never
  from the launch directory.
- Test doubles now return the `{ok, value}` envelope the official client Remote
  actually produces.

## Not verified

- **The model's response.** No API key was used anywhere in this work, so no
  turn reached a model. What *is* verified is the model-visible content: the
  message the runtime composed from an inserted reference is
  `summarize @src/main.ts`. Whether the agent then reads that path is the
  official tool layer's behaviour, not this distribution's.
- **Windows, on any of it.** The build definition exists and has never run on a
  Windows host.

## One false alarm, recorded so it is not re-chased

A first send appeared to produce `read ￼ read @src/main.ts` — a surviving
placeholder and a doubled prefix. That was a **test artifact**: the composer
restores its draft from `localStorage`, so a reload before the second attempt
left the earlier draft in place and the new typing appended to it. Clearing the
persisted draft and repeating the run produced the correct single message. The
symptom is worth knowing because it looks exactly like a serialization bug.
