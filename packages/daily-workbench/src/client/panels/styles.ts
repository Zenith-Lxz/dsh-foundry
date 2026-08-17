/**
 * Workbench panel styles.
 *
 * Every colour is a real official `--dsw-alias-*` token with no literal
 * fallback. A fallback here is worse than a missing style: a hardcoded
 * `#ffffff` behind a token name renders a white panel on a dark theme and looks
 * deliberate, which is exactly the defect that shipped in the title bar before
 * the token names were read off the live stylesheet instead of guessed.
 *
 * The only literals are the three status hues, which carry meaning the neutral
 * palette does not encode, and they are defined once per theme rather than
 * inline.
 * @module @dsh-foundry/daily-workbench/client/panels/styles
 */

/** The stylesheet, installed once per client. */
export const WORKBENCH_CSS = `
.dshw-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  padding: 12px;
  color: var(--dsw-alias-label-primary);
  font-size: 13px;
  overflow-y: auto;
}

.dshw-panel--empty { align-items: flex-start; }
.dshw-empty-title { font-weight: 600; margin: 0; }
.dshw-empty-body { color: var(--dsw-alias-label-secondary); margin: 0; }

.dshw-scope-note {
  color: var(--dsw-alias-label-tertiary);
  font-size: 12px;
  line-height: 1.5;
  margin: 0;
  padding-top: 8px;
  border-top: 1px solid var(--dsw-alias-border-l1);
}

.dshw-section { display: flex; flex-direction: column; gap: 6px; }
.dshw-section-title {
  display: flex; align-items: center; gap: 8px;
  font-size: 12px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.04em; color: var(--dsw-alias-label-secondary); margin: 0;
}
.dshw-section-note { color: var(--dsw-alias-label-tertiary); font-size: 12px; margin: 0; }
.dshw-count {
  background: var(--dsw-alias-interactive-bg-hover);
  border-radius: 999px; padding: 0 6px; font-size: 11px;
}

.dshw-rows, .dshw-groups, .dshw-matches { list-style: none; margin: 0; padding: 0; }
.dshw-rows { display: flex; flex-direction: column; gap: 2px; }

.dshw-row {
  display: flex; align-items: center; gap: 8px;
  padding: 4px 6px; border-radius: 6px; min-width: 0;
}
.dshw-row:hover { background: var(--dsw-alias-interactive-bg-hover); }

.dshw-row-path {
  flex: 1 1 auto; min-width: 0;
  background: none; border: none; padding: 0;
  color: var(--dsw-alias-label-primary);
  font: inherit; text-align: left; cursor: pointer;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshw-row-path:hover { text-decoration: underline; }

.dshw-row-action, .dshw-button {
  background: none; border: 1px solid var(--dsw-alias-border-l1);
  border-radius: 5px; padding: 1px 7px;
  color: var(--dsw-alias-label-secondary);
  font: inherit; font-size: 11px; cursor: pointer; white-space: nowrap;
}
.dshw-row-action:hover, .dshw-button:hover {
  background: var(--dsw-alias-interactive-bg-hover);
  color: var(--dsw-alias-label-primary);
}
.dshw-button { align-self: flex-start; padding: 4px 12px; font-size: 12px; }

.dshw-code, .dshw-command, .dshw-preview {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12px;
}
.dshw-code { color: var(--dsw-alias-label-tertiary); width: 2ch; flex: none; }
.dshw-detail { color: var(--dsw-alias-label-tertiary); font-size: 12px; margin: 0; }

.dshw-attribution {
  font-size: 11px; padding: 0 6px; border-radius: 999px; white-space: nowrap;
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-tertiary);
}
/* Only "changed outside" and "both" are tinted. Marking the agent's own edits
   would tint nearly every row and stop carrying information. */
.dshw-attribution--external, .dshw-attribution--both {
  color: var(--dshw-caution); border-color: var(--dshw-caution);
}

.dshw-outcome, .dshw-state, .dshw-severity {
  font-size: 11px; font-weight: 600; text-transform: uppercase;
  letter-spacing: 0.03em; white-space: nowrap; flex: none;
}
.dshw-outcome--pass { color: var(--dshw-good); }
.dshw-outcome--fail, .dshw-severity--blocking { color: var(--dshw-bad); }
.dshw-outcome--unknown, .dshw-severity--warning { color: var(--dshw-caution); }
.dshw-severity--info, .dshw-state { color: var(--dsw-alias-label-tertiary); }

.dshw-warning {
  margin: 0; padding: 8px 10px; border-radius: 6px;
  background: var(--dsw-alias-interactive-bg-hover);
  border-left: 2px solid var(--dshw-caution);
  color: var(--dsw-alias-label-secondary);
  font-size: 12px; line-height: 1.5;
}
.dshw-row-warning { color: var(--dshw-caution); font-size: 11px; }
.dshw-section--alert .dshw-section-title { color: var(--dshw-caution); }

.dshw-branch { display: flex; align-items: center; gap: 8px; margin: 0; color: var(--dsw-alias-label-secondary); }

.dshw-meter {
  position: relative; height: 22px; border-radius: 6px; overflow: hidden;
  background: var(--dsw-alias-interactive-bg-hover);
}
.dshw-meter-fill { position: absolute; inset: 0 auto 0 0; background: var(--dsw-alias-border-l1); }
.dshw-meter-label {
  position: relative; display: flex; align-items: center; height: 100%;
  padding: 0 8px; font-size: 11px; color: var(--dsw-alias-label-secondary);
}

.dshw-search-header { display: flex; align-items: baseline; gap: 10px; }
.dshw-stale { color: var(--dshw-caution); font-size: 12px; }
.dshw-group { padding-bottom: 8px; }
.dshw-group-path {
  margin: 0 0 2px; font-size: 12px; font-weight: 600;
  color: var(--dsw-alias-label-secondary);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.dshw-match {
  display: flex; gap: 10px; width: 100%; min-width: 0;
  background: none; border: none; padding: 2px 6px; border-radius: 5px;
  font: inherit; text-align: left; cursor: pointer;
  color: var(--dsw-alias-label-primary);
}
.dshw-match:hover { background: var(--dsw-alias-interactive-bg-hover); }
.dshw-line { color: var(--dsw-alias-label-tertiary); min-width: 4ch; text-align: right; flex: none; }
.dshw-preview { overflow: hidden; text-overflow: ellipsis; white-space: pre; }

.dshw-tabs {
  display: flex; gap: 2px; padding: 6px 8px 0;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dshw-tab {
  background: none; border: none; border-bottom: 2px solid transparent;
  padding: 5px 10px; font: inherit; font-size: 12px; cursor: pointer;
  color: var(--dsw-alias-label-tertiary);
}
.dshw-tab:hover { color: var(--dsw-alias-label-primary); }
.dshw-tab[aria-selected='true'] {
  color: var(--dsw-alias-label-primary);
  border-bottom-color: var(--dsw-alias-label-primary);
}
.dshw-tab-badge {
  margin-left: 5px; font-size: 10px; padding: 0 5px; border-radius: 999px;
  background: var(--dsw-alias-interactive-bg-hover);
}

.dshw-plugin-row {
  display: flex; flex-direction: column; gap: 3px;
  padding: 8px 6px; border-radius: 6px;
  border-bottom: 1px solid var(--dsw-alias-border-l1);
}
.dshw-plugin-head { display: flex; align-items: center; gap: 8px; min-width: 0; }

.dshw-source {
  font-size: 11px; padding: 1px 7px; border-radius: 999px; white-space: nowrap; flex: none;
  border: 1px solid var(--dsw-alias-border-l1);
  color: var(--dsw-alias-label-secondary);
}
.dshw-source--foundry { color: var(--dshw-good); border-color: var(--dshw-good); }
/* Unknown is tinted like a caution, not left neutral: a row shown without a
   source reads as unremarkable, which is the wrong impression for a package
   nothing vouched for. */
.dshw-source--unknown { color: var(--dshw-caution); border-color: var(--dshw-caution); }

.dshw-verified {
  font-size: 11px; color: var(--dshw-good); white-space: nowrap; flex: none;
}

.dshw-search-label { display: block; }
.dshw-search-input {
  width: 100%; box-sizing: border-box;
  padding: 6px 10px; border-radius: 6px;
  border: 1px solid var(--dsw-alias-border-l1);
  background: var(--dsw-alias-bg-base);
  color: var(--dsw-alias-label-primary);
  font: inherit; font-size: 13px;
}
.dshw-search-input:focus-visible {
  outline: 2px solid var(--dsw-alias-label-primary);
  outline-offset: 1px;
}

/* Available to screen readers, absent from the visual layout. */
.dshw-visually-hidden {
  position: absolute; width: 1px; height: 1px;
  padding: 0; margin: -1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; border: 0;
}

.dshw-tab:focus-visible, .dshw-row-action:focus-visible, .dshw-button:focus-visible,
.dshw-row-path:focus-visible, .dshw-match:focus-visible {
  outline: 2px solid var(--dsw-alias-label-primary);
  outline-offset: 1px;
}

@media (prefers-reduced-motion: reduce) {
  .dshw-meter-fill { transition: none; }
}

:root {
  --dshw-good: #1a7f4b;
  --dshw-bad: #b3261e;
  --dshw-caution: #8a5a00;
}
:root[data-theme='dark'], .dsw-theme-dark {
  --dshw-good: #4ade80;
  --dshw-bad: #f87171;
  --dshw-caution: #fbbf24;
}
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) {
    --dshw-good: #4ade80;
    --dshw-bad: #f87171;
    --dshw-caution: #fbbf24;
  }
}
`

/** Element id of the injected stylesheet, so a reload replaces rather than stacks. */
export const STYLE_ELEMENT_ID = 'dsh-workbench-styles'

/**
 * Install the workbench stylesheet.
 * @param document - The document to install into.
 * @returns A disposer that removes the stylesheet.
 */
export function installWorkbenchStyles(document: Document): () => void {
  const existing = document.getElementById(STYLE_ELEMENT_ID)
  if (existing !== null) existing.remove()
  const style = document.createElement('style')
  style.id = STYLE_ELEMENT_ID
  style.textContent = WORKBENCH_CSS
  document.head.append(style)
  return () => style.remove()
}
