# Deterministic mechanics — darwin

result: PASS

check | outcome | duration | establishes
--- | --- | --- | ---
coupling | pass | 1.3s | no private coupling to the upstream checkout exists in any tracked or untracked file
lint | pass | 8.5s | no unexplained `any`, floating promise, or loose equality reaches the tree, with every exception narrowed and justified at its site
unit | pass | 11.3s | every package behaves as its tests describe
typecheck | pass | 1.8s | every package compiles under strict TypeScript against the pinned DSH types
probe | pass | 0.7s | every public DSH extension point this distribution depends on exists in the pinned version
qualify-profile | pass | 2.1s | the desktop profile installs through the official plugin command and drops no official row
qualify-daily | pass | 2.7s | the daily profile decorates the live official Standard preset without disabling any official row
qualify-desktop-daily | pass | 3.9s | daily composes inside the desktop profile without changing what the shell owns, and the whole product still composes with the native bridge disabled
oracles | pass | 5.4s | every corpus oracle rejects its untouched fixture and accepts its reference solution
bundle | pass | 3.6s | every package produces its declared runtime entries from the bundler, not from a type-check side effect
inject | pass | 0.4s | every service a client plugin injects has its providing package declared, so no plugin can load with apply() never running
closure | pass | 4.4s | every companion tarball loads under plain Node with no missing module, verified from the packed artifact rather than from src
remotes | pass | 0.4s | every Remote face is invocable through the official Gateway: no #private field it cannot read on the service proxy, and no official import that a profile could resolve to a second copy
window | pass | 6.8s | the live packaged window applies its declared policy: no Node reachable, no Electron global exposed, window-open and webview attachment denied, and the layout resolving without overflow at every qualified width
doctor | pass | 1.4s | the doctor reports composition and authority correctly from a freshly provisioned profile, independent of the developer machine

## Model evaluation: UNRUN

No DEEPSEEK_API_KEY was available, so no model-dependent task ran. Model evaluation is UNRUN — not passed, and not skipped as acceptable.

This suite verifies prompt-independent behavior. A pass says nothing about answer quality, which only the model-dependent corpus can measure.
