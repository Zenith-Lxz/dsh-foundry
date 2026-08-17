/**
 * Where the workbench mounts, and what it does without a desktop shell.
 *
 * The workbench is a browser plugin that a desktop shell may host, never a
 * desktop feature that also happens to run in a browser. Two rules follow, and
 * both are enforced rather than intended:
 *
 * - **Every panel occupies a public official slot.** The mount plan is data, so
 *   a slot that does not exist upstream fails at load instead of rendering
 *   nowhere.
 * - **No workbench data crosses Electron IPC.** Status, diffs, search, and
 *   verification all travel the official Typert Remote over HTTP. The desktop
 *   bridge carries window operations only, and `gate:coupling` fails the build
 *   if a workbench module imports it.
 *
 * What a desktop shell adds is presentation affordance — a wider details column,
 * a native directory picker — never a capability the browser lacks.
 * @module @dsh-foundry/daily-workbench/client/mount
 */

/**
 * Official slot kinds, read off the shipped contract rather than assumed.
 *
 * The distinction that matters is `single` versus `list`. A `single` slot has
 * one occupant, so registering into it *replaces* whatever the official product
 * put there; a `list` slot accepts an additional entry alongside the existing
 * ones. An additive surface like the workbench belongs only in a `list` slot.
 *
 * `conversation.details.tool` is `single`, and its own contract states that
 * taking it means rendering every tool's output. It is recorded here so the
 * plan cannot drift back onto it.
 */
export const OFFICIAL_SLOT_KINDS = {
  'conversation.session.header.utilities': 'list',
  'conversation.session.header.actions': 'list',
  'conversation.view': 'list',
  'conversation.input.dock': 'list',
  'conversation.input.left': 'list',
  'conversation.input.right': 'list',
  'conversation.details.tool': 'single',
  'conversation.composer.bar': 'single',
  'conversation.hero.workspace': 'single',
} as const

/** Public official slots the workbench registers into. */
export const WORKBENCH_SLOTS = {
  /** Review, verification, context, jobs, subagents, attention. */
  panels: 'conversation.view',
  /** Search results, opened from the input dock. */
  search: 'conversation.input.dock',
  /** The workbench toggle. */
  toggle: 'conversation.session.header.utilities',
} as const

/** One panel's placement. */
export interface PanelPlacement {
  readonly id: string
  readonly title: string
  readonly slot: (typeof WORKBENCH_SLOTS)[keyof typeof WORKBENCH_SLOTS]
  /**
   * Whether the panel works with no desktop shell present.
   *
   * Every panel does. A `false` here would mean the workbench had grown a
   * desktop-only capability, which the mount test rejects.
   */
  readonly browserCapable: true
}

/** The complete mount plan. */
export const MOUNT_PLAN: readonly PanelPlacement[] = [
  { id: 'review', title: 'Changes', slot: WORKBENCH_SLOTS.panels, browserCapable: true },
  { id: 'verification', title: 'Checks', slot: WORKBENCH_SLOTS.panels, browserCapable: true },
  { id: 'context', title: 'Context', slot: WORKBENCH_SLOTS.panels, browserCapable: true },
  { id: 'jobs', title: 'Jobs', slot: WORKBENCH_SLOTS.panels, browserCapable: true },
  { id: 'subagents', title: 'Subagents', slot: WORKBENCH_SLOTS.panels, browserCapable: true },
  { id: 'attention', title: 'Attention', slot: WORKBENCH_SLOTS.panels, browserCapable: true },
  { id: 'search', title: 'Search', slot: WORKBENCH_SLOTS.search, browserCapable: true },
  { id: 'toggle', title: 'Workbench', slot: WORKBENCH_SLOTS.toggle, browserCapable: true },
]

/** What a hosting desktop shell may change. Presentation only. */
export interface ShellAffordances {
  /** A native directory picker is available through the shell. */
  readonly nativeDirectoryPicker: boolean
  /** The shell reserves vertical space for its own title bar. */
  readonly reservedTitleBarHeight: number
}

/** What the workbench assumes when no shell is hosting it. */
export const BROWSER_AFFORDANCES: ShellAffordances = {
  nativeDirectoryPicker: false,
  reservedTitleBarHeight: 0,
}

/**
 * Resolve the affordances for the current host.
 *
 * Absence of a shell is an ordinary case, not a degraded one: the browser
 * defaults are the baseline every panel is written against.
 * @param shell - Affordances the hosting shell reported, when one is hosting.
 * @returns The affordances in effect.
 */
export function resolveAffordances(shell: ShellAffordances | undefined): ShellAffordances {
  return shell ?? BROWSER_AFFORDANCES
}

/**
 * Check that a mount plan can be satisfied by the slots a build declares.
 *
 * Run at load so a slot renamed upstream fails loudly here, rather than
 * producing a panel that silently renders nowhere.
 * @param declaredSlots - Slot names the runtime declares.
 * @param plan - The mount plan.
 * @returns Panels whose slot does not exist.
 */
export function unsatisfiablePanels(
  declaredSlots: readonly string[],
  plan: readonly PanelPlacement[] = MOUNT_PLAN,
): PanelPlacement[] {
  return plan.filter((panel) => !declaredSlots.includes(panel.slot))
}
