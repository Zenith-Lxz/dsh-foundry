/**
 * Window title composition.
 *
 * A desktop window titles itself after what it currently holds, not after the
 * application — the application name is already in the menu bar on macOS and in
 * the taskbar on Windows, so repeating it centred in the frame is redundant.
 *
 * The parts come from official state: the workspace that accounts for the
 * current session, and that session's own display title. Neither is
 * recomputed here — `displayTitle` already resolves durable title, then project
 * basename, then session id, and re-deriving that would drift from the sidebar.
 * @module @dsh-foundry/layout/client/title
 */

/** Separator between the workspace and the session, matching desktop title conventions. */
const SEPARATOR = ' — '

/**
 * Compose the window title from whatever context is currently known.
 *
 * Each part is optional because the states settle independently: a session can
 * be current before its workspace list has arrived, and a workspace can be
 * selected with no session yet. The application name is the last resort rather
 * than a prefix, so the title never repeats what the menu bar already shows.
 * @param workspace - Title of the workspace accounting for the current session.
 * @param session - Current session's display title.
 * @param applicationName - Shown only when there is no context at all.
 * @returns The composed title.
 */
export function composeWindowTitle(
  workspace: string | undefined,
  session: string | undefined,
  applicationName: string,
): string {
  const parts = [workspace, session]
    .map((part) => part?.trim())
    .filter((part): part is string => part !== undefined && part.length > 0)
  // A session with no durable title falls back to its project basename, which
  // is the workspace directory name — so an untitled session in workspace
  // "ppt" would title the window "ppt — ppt". One name is the information.
  const distinct = parts.filter((part, index) => parts.indexOf(part) === index)
  return distinct.length === 0 ? applicationName : distinct.join(SEPARATOR)
}
