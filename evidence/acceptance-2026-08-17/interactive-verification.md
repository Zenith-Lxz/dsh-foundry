# Interactive verification — not achieved

Three acceptance items have no end-to-end evidence: the `@` menu appearing on
keypress, creating a session, and switching agent mode.

## What was tried

| approach | outcome |
| --- | --- |
| Type into the packaged window (computer-use) | clicks register, keystrokes never reach the app |
| Force the app frontmost first, then type | unchanged |
| Send a key combination rather than text | unchanged |
| Drive the desktop profile in a browser | refused by design — the layout requires the desktop bridge |
| Build a web profile carrying the same client bundle | UI loads, workspace selection needs the directory-picker seam |
| Seed the workspace store to bypass the picker | workspace appears in the sidebar |
| Select it by mouse, then by keyboard | the dropdown stays open; selection does not commit |

An API-key dialog appeared during this and was dismissed with "Configure
later". No credential was entered.

## After the client-loading defect was fixed

The blocker moved. Before, the plugin never reached the page at all; now it
does, and three things are verified from the running application:

| checked | result |
| --- | --- |
| the runtime serves the client bundle | `GET /plugins/@dsh-foundry/daily-workbench/client.js` → 200 |
| `apply()` executed | `#dsh-workbench-styles` present in the document, 8011 bytes |
| its stylesheet is live | `--dshw-good` computes to `#4ade80` |

`apply()` running is what registers the `@` source and the slot entries, so the
registration path is exercised end to end by the running product.

What remains unverified is the last step only: the menu's appearance when a key
is pressed. Reaching it needs a bound workspace, and workspace selection does
not commit under automation — a full synthetic pointer sequence
(`pointerover/enter/down`, `mousedown`, `pointerup`, `mouseup`, `click`) on the
menu item leaves the trigger reading "Choose workspace" and the composer
disabled. Trusted CDP events behave the same: hovering the item, then clicking it, closes
the menu without binding — the trigger still reads "Choose workspace" and the
composer keeps its "Choose a workspace to start" placeholder. The workspace was
seeded directly into `storages/workspace.json` and does appear in the sidebar,
so the likely cause is that a seeded record satisfies the listing but not
whatever the binding path validates. Selecting it by hand in the desktop
application is the remaining route.

## Two further defects found and fixed while verifying

**`cannot get property "remote.dshWorkbench" without inject`.** With the plugin
finally reaching the page, the console showed the `@` source registering, being
called by the menu, and failing on every query: Cordis refuses a property read
on a service the fiber did not inject, and `remote` alone does not cover
`remote.dshWorkbench`. Listing it at the top level deadlocks instead — this
plugin is what mounts that namespace, so the fiber waits forever on a service
only its own body creates, and the whole plugin fails to activate with
`pending (waiting for service: remote.dshWorkbench)`. The working shape is a
child scope: mount the contribution, then `ctx.inject(['remote.dshWorkbench'],
scope => …)` and register the source inside it. The console error is gone.

**Two rounds of verification were run against a stale server.** Port 3080 stayed
held by an earlier instance, so a freshly started one died with `EADDRINUSE`
while the page kept talking to the old process and the old bundle. The failing
`ERR_CONNECTION_REFUSED` lines were the signal. Any verification that restarts a
server on a fixed port has to confirm the port was actually released first.

## Still not rendering

The draft-state hypothesis was ruled out. The composer draft is persisted in
`localStorage` under `dsh.conversation.chat.<sessionId>`, which is why repeated
attempts accumulated `@@@` and never presented a fresh trigger. Clearing that
key, reloading, and typing a single `@` with real key events into an empty
draft — on a fresh server, with both defects fixed and a bound workspace —
still produces no menu and **no console error at all**.

## The decisive measurement

A temporary `console.log` was added to the source's own `candidates` callback
and the build re-run. Typing `@` into an empty draft on a fresh server produces
**no log line at all**: the official pipeline never asks this source for
candidates. That rules out everything on this side of the call — the query, the
Host round trip, the rendering — and places the failure in registration or in
trigger detection.

One hypothesis was tested and rejected. `sessionOf` warms a session's source
roster once when the scope comes alive, so a source registered after an awaited
`$mount` would be missing from any session that already existed. The
registration was restructured to happen synchronously in `apply`, with the
remote resolved at query time through a promise. `candidates` is still never
called, so late registration was not the cause.

The diagnostic log was removed; it is debug instrumentation, not product code.

## Correction: the source *is* called

A second diagnostic run — logging at registration as well as at query time —
captured both:

```
[diag] about to registerSource, inputTriggers= object
[dsh-foundry][diag] candidates called, query= ""
```

So registration is reached and the official pipeline **does** ask this source
for candidates when `@` is typed. The earlier "never called" reading was wrong:
that run had not actually reloaded the rebuilt bundle.

That moves the remaining question again, to the last stretch only — what
happens to the returned candidates. The likely suspect is the promise the
source now awaits for its remote: if `remoteReady` never settles, `candidates`
hangs and the menu has nothing to render, with no error to show for it.
Resolving it eagerly, or racing it against a timeout that returns an explicit
"not ready" row, is the change to try.

## Final measurement, on a verified-clean environment

The environment was made to prove itself first: port 3080 confirmed free with no
`EADDRINUSE`, the workspace seeded through `realpath` (`/private/tmp/...`), every
`dsh.*` localStorage key cleared and the page reloaded, and the **served** bundle
confirmed to contain this round's change (`REMOTE_READY_TIMEOUT` present in the
response body).

Typing a single `@` into an empty draft then produces no menu, and no menu
element exists in the DOM. Waiting past the two-second guard and typing another
character does not produce the "file references are still starting" row either.

That last part is the informative half: the guard returns that row whenever the
remote is not ready, so its absence means `candidates` was **not called at all**
in this session. The successful call captured in the previous round therefore
came from a differently-initialised session, not from the path a user takes.

What that leaves: registration is reached (logged), the plugin is served and
applied (verified), and the source is consulted in some sessions but not in the
one a user gets. The difference between those two sessions is the next thing to
find.

## The registration shape matches the official one

`@deepseek-ai/dsh-client-ui-skill` registers the `/` source like this:

```js
const inputTriggers = ctx.get('inputTriggers')
ctx.effect(() => {
  const unregister = inputTriggers.registerSource(source)
  return () => { unregister(); clearAll() }
}, 'ui-skill: source')
```

This project's `@` source is registered the same way — inside `ctx.effect`,
returning the disposer — reached through `ctx.inputTriggers` rather than
`ctx.get('inputTriggers')`, which resolves to the same service. The source
object carries `trigger`, `name`, `candidates`, and `onPick`; the official one
additionally declares `order`, `lexicon`, and `onLexiconChange`, all documented
as optional and none governing whether the menu opens.

So the defect is not in the registration shape. Combined with the call captured
at warm-up but not on keystroke, what remains is how a session's controller
builds its roster and when this source enters it.

## Reference participation hooks: added, did not fix it

The contract says of `lexicon` that "implementing IS the participation claim"
for a reference trigger, and `warm` fills a source's backing data once per
session scope. A `/` command source needs neither, which is why the official
skill source has no `warm`; an `@` reference source plausibly does. Both were
implemented — `warm` fetches a bounded path roll, `lexicon` answers
synchronously from it and returns `undefined` until warm so the render path
never fetches, `subscribeLexicon` notifies on refresh.

The menu still does not open. The hooks were kept: reference decoration is real
behaviour that a reference source is supposed to provide, and the contract asks
for them regardless of this defect. But they are not the cause.

## The likely answer: `@` is inert before a session exists

Reading `dsh-client-ui-input-trigger`'s detection instead of inferring from
outside:

```js
const detectTrigger = (draft, caret, guard) => {
  if (guard.tier === 'frozen') return null
  ...
}
```

and the tier comes from the input machine's phase, in `SessionInputShell` — the
**per-session** input facade:

```js
function guardOf(phase) {
  switch (phase) {
    case 'plain': return 'plain'
    case 'claimed': return 'claimed'
    default: return 'frozen'
  }
}
```

The conversation package describes the no-session composer as having **no
machine**: `INERT_DECORATIONS` is the "decoration product of the no-session
state (no machine, empty draft)". No machine means no phase, `guardOf` falls to
`frozen`, and `detectTrigger` returns `null` before any source is consulted.

**So `@` opening no menu on the hero screen is the designed behaviour, not a
defect.** Every attempt recorded above — and the original audit screenshot
`04-at-file-menu.png` — was made on the hero composer, before a session existed.
That also explains the one observation that never fit: `candidates` running at
warm-up but never on a keystroke.

This does not retroactively make the four fixed defects imaginary; each was real
and independently verified. It means the *symptom* that started the hunt may
have been a test that could not have passed.

The remaining check is to exercise `@` inside a live session, which needs a
session to exist, which needs a message to be sent.

## The measurement environment is unreliable

Every round fought the harness rather than the product: the profile server on a
fixed port kept dying (`EADDRINUSE` from a previous instance, then
`ERR_CONNECTION_REFUSED` in the page while it appeared to be up), the composer
draft persisted in `localStorage` across reloads so `@` accumulated instead of
triggering, `/tmp` resolved through a symlink so a seeded workspace listed but
would not bind, and a stale bundle served twice. Several conclusions in this
document were drawn against one of those conditions and had to be withdrawn.

Anyone continuing should start by making the environment prove itself: a unique
port per run, a cleared draft key, a realpath'd workspace, and an assertion that
the served bundle contains the change under test.

## What this does and does not mean

It is **not** evidence that the feature is broken. It is the absence of
evidence either way, and the two are not the same.

The indirect evidence is stronger than it was: candidate generation runs
against the real `WorkbenchCapability` on a real filesystem (`tests/reference-integration.test.ts`),
`registerSource` is present in both the workspace bundle and the tarball inside
the shipped `.app`, and `probe:contracts` confirms the public
`client.inputTriggers` seam exists.

None of that exercises the keypress path, which is the part a user touches.

## Why this is recorded rather than waived

Twice in this session a surface with only indirect evidence turned out to be
broken:

- `smoke:app` passed for several rounds while the upgrade path failed at launch,
  because the smoke only ever used a fresh Harness home.
- The authored Remote contract passed its own tests while declaring `patch`
  where the Host returns `text`, so strict validation would have rejected every
  diff at the wire boundary. Method names and arity were pinned; field names
  were not.

Both were found by driving the real thing instead of a stand-in. Interactive
verification is currently in the same position those two were in, so it is
recorded as unverified rather than inferred from unit tests.

## What would close it

A harness that delivers real key events to the packaged window, or a browser
session where workspace selection commits. Either one, then: type `@`, assert
the menu lists workspace files, arrow to a candidate, press Enter, and assert
the draft contains the path rather than the file's contents.
