# Application icon

`icon.svg` is the source; `icon.icns` is generated from it by
`pnpm run build:icon` and is regenerated rather than hand-edited.

## Provenance

The whale glyph is **DeepSeek's official mark**, taken from the upstream
Harness repository (`apps/web/public/favicon.svg`) and reproduced here
unmodified apart from being placed on a tile and given an explicit fill.

The upstream file carries a `prefers-color-scheme: dark` rule that repaints the
glyph white. Quick Look honours that rule, so rasterizing the upstream file
directly yields a white glyph on transparency — invisible against a light Dock.
`icon.svg` therefore states its colors explicitly and carries no media query.

The tile follows Apple's macOS grid: an 824 px rounded square centered in a
1024 px canvas, with the remaining margin transparent. Filling the whole canvas
makes the icon read as oversized beside every other icon in the Dock.

## What this asset does not claim

**DSH Foundry is not a DeepSeek product and is not affiliated with DeepSeek.**
That is stated in both READMEs and in the application itself. Using the upstream
project's mark identifies what this distribution packages; it is not a claim of
endorsement, authorship, or official status.

Anyone redistributing this build should decide for themselves whether shipping
another organisation's mark as their application icon is appropriate — a
distribution that is not the upstream project wearing the upstream project's
icon is exactly the confusion trademarks exist to prevent. Replacing
`icon.svg` with a distinct mark and re-running `pnpm run build:icon` is the one
change required.
