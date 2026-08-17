/**
 * The desktop-only compatibility surface.
 *
 * The frame renders native window controls and a platform safe area, both of
 * which are wrong without a compatible bridge. So when the bridge is missing or
 * reports a version this build does not speak, the frame states the detected
 * and required versions instead of presenting itself as ready — a nonfunctional
 * caption button is worse than an explained absence.
 *
 * Copy is bilingual for the same reason as the startup surfaces: a
 * compatibility failure is exactly when a reader cannot reach a language
 * setting.
 * @module @dsh-foundry/layout/client/CompatibilitySurface
 */
import type { ReactElement } from 'react'

/** The two statuses that stop the frame from presenting. */
export type IncompatibleStatus =
  | { readonly kind: 'absent' }
  | { readonly kind: 'incompatible', readonly detected: number, readonly required: number }

/**
 * Render the compatibility surface.
 * @param props - The blocking status.
 * @returns The surface element.
 */
export function CompatibilitySurface({ status }: { readonly status: IncompatibleStatus }): ReactElement {
  return (
    <div className="dshd-compat">
      <div className="dshd-compatCard" role="alert">
        {status.kind === 'absent' ? (
          <>
            <h1>桌面原生桥不可用</h1>
            <h2>The desktop native bridge is unavailable</h2>
            <p>此界面由 <code>@dsh-foundry/layout</code> 提供，需要在 DeepSeek Harness 桌面应用中运行。</p>
            <p>
              This frame is provided by <code>@dsh-foundry/layout</code> and requires the
              DeepSeek Harness desktop application.
            </p>
            <p>在普通浏览器中请改用官方 <code>web</code> Profile。</p>
            <p>
              In an ordinary browser, use the official <code>web</code> profile instead.
            </p>
          </>
        ) : (
          <>
            <h1>桌面原生桥版本不兼容</h1>
            <h2>The desktop native bridge version is not supported</h2>
            <p>
              需要 / required: <code>v{status.required}</code>
              {' · '}
              检测到 / detected: <code>v{status.detected}</code>
            </p>
            <p>请将桌面应用与该客户端插件更新到同一版本。</p>
            <p>Update the desktop application and this client plugin to the same version.</p>
          </>
        )}
      </div>
    </div>
  )
}
