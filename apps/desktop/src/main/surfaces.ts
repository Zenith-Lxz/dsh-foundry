/**
 * Desktop-owned startup and failure surfaces.
 *
 * These are companion chrome, not Harness UI: they are what the window shows
 * before the official client origin is trusted, and what replaces it when the
 * host cannot be started or has exited. They are rendered from `data:` URLs so
 * they carry no origin authority and never receive the preload bridge.
 *
 * Copy is bilingual because the product ships to Chinese and English users and
 * a startup failure is exactly when a reader cannot switch languages.
 * @module @dsh-foundry/app/main/surfaces
 */
import { app } from 'electron'

/**
 * The product's display name.
 *
 * `app.getName()` reads what the packager stamped from `product.json`, so the
 * shell, the failure surfaces, and the packaged bundle can never disagree about
 * what this application is called. A source launch has no packaged name, so it
 * falls back to the same value the manifest carries.
 */
const PRODUCT_DISPLAY_NAME = app.getName()

/** Palette shared by the surfaces, in both color schemes. */
const STYLE = `
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; min-height: 100vh; display: flex; align-items: center; justify-content: center;
    font: 13px/1.6 -apple-system, "Segoe UI", system-ui, sans-serif;
    background: #fbfbfd; color: #1d1d1f; -webkit-user-select: none; user-select: none;
  }
  main { max-width: 46em; padding: 2.5rem; }
  h1 { font-size: 1.05rem; font-weight: 600; margin: 0 0 .35rem; }
  h2 { font-size: .95rem; font-weight: 500; margin: 0 0 1.25rem; color: #6e6e73; }
  p { margin: .4rem 0; color: #424245; }
  pre {
    white-space: pre-wrap; word-break: break-word; margin: 1rem 0 0; padding: .85rem 1rem;
    background: #f0f0f2; border-radius: 8px; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
    color: #424245; max-height: 15em; overflow: auto; -webkit-user-select: text; user-select: text;
  }
  .spinner {
    width: 18px; height: 18px; margin-bottom: 1rem; border-radius: 50%;
    border: 2px solid #d2d2d7; border-top-color: #6e6e73; animation: spin .8s linear infinite;
  }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
  @media (prefers-color-scheme: dark) {
    body { background: #1c1c1e; color: #f5f5f7; }
    h2 { color: #98989d; } p { color: #d1d1d6; }
    pre { background: #2c2c2e; color: #d1d1d6; }
    .spinner { border-color: #3a3a3c; border-top-color: #98989d; }
  }
`

/**
 * Render one surface as a `data:` URL.
 * @param title - Document title.
 * @param body - Body markup.
 * @returns A `data:text/html` URL.
 */
function surface(title: string, body: string): string {
  const html = `<!doctype html><html><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">`
    + `<title>${escapeHtml(title)}</title><style>${STYLE}</style></head><body><main>${body}</main></body></html>`
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`
}

/**
 * The surface shown while the owned DSH host is starting.
 * @returns A `data:` URL for the loading surface.
 */
export function loadingSurface(): string {
  return surface(
    PRODUCT_DISPLAY_NAME,
    '<div class="spinner"></div>'
    + `<h1>正在启动 ${PRODUCT_DISPLAY_NAME}</h1>`
    + `<h2>Starting ${PRODUCT_DISPLAY_NAME}</h2>`
    + '<p>正在准备本地运行时并等待就绪信号。</p>'
    + '<p>Preparing the local runtime and waiting for its ready signal.</p>',
  )
}

/**
 * The surface shown when startup fails or the owned host exits.
 * @param headline - Short bilingual headline pair.
 * @param detail - Bounded, already-redacted diagnostic text.
 * @returns A `data:` URL for the failure surface.
 */
export function failureSurface(headline: { zh: string, en: string }, detail: string): string {
  return surface(
    PRODUCT_DISPLAY_NAME,
    `<h1>${escapeHtml(headline.zh)}</h1>`
    + `<h2>${escapeHtml(headline.en)}</h2>`
    + '<p>该窗口不会加载任何界面，直到本地运行时重新就绪。</p>'
    + '<p>This window will not load an interface until the local runtime is ready again.</p>'
    + `<pre>${escapeHtml(detail)}</pre>`,
  )
}

/**
 * Escape text for inclusion in HTML.
 * @param value - Raw text.
 * @returns The escaped text.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}
