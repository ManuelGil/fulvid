/**
 * Shared Shell command metadata and dispatch.
 *
 * The registry deliberately stays small: it is a bridge between the
 * Application Menu, Quick Actions, shortcuts, and the existing page actions,
 * not a second navigation or state system.
 */

import { type MarkdownCommandId } from "../modules/editor/markdown/markdownFormat";

export type CommandId =
  | "newDocument"
  | "newDocumentNote"
  | "newDocumentMeeting"
  | "newDocumentDaily"
  | "newDocumentProject"
  | "openFile"
  | "save"
  | "saveAs"
  | "exportHtml"
  | "closeDocument"
  | "closeOthers"
  | "closeAll"
  | "openWorkspace"
  | "closeWorkspace"
  | "refreshWorkspace"
  | "revealWorkspace"
  | "copyWorkspacePath"
  | "revealDocument"
  | "copyDocumentPath"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "deleteSelection"
  | "selectAll"
  | "indentLines"
  | "outdentLines"
  | "duplicateSelection"
  | "find"
  | "replace"
  | "findReferences"
  | "renameHeading"
  | "togglePreview"
  | "toggleWritingFocus"
  | "toggleLeftSidebar"
  | "toggleRightSidebar"
  | "toggleFullscreen"
  | "annotateDocument"
  | "removeAnnotation"
  | "nextAnnotation"
  | "previousAnnotation"
  | "clearAnnotations"
  | "toggleDocumentAnnotations"
  | "openExplorer"
  | "openEditor"
  | "openGraph"
  | "openQuickOpen"
  | "openGlobalSearch"
  | "openOutline"
  | "nextTab"
  | "previousTab"
  | "toggleStatusbar"
  | "openSettings"
  | "openKeyboardShortcuts"
  | "openAbout"
  | "quit"
  | MarkdownCommandId;

export type CommandHandler = () => void | Promise<void>;

/** Convert the human-readable shortcut notation into ARIA key tokens. */
export function toAriaKeyshortcuts(shortcut?: string): string | undefined {
  if (!shortcut) {
    return undefined;
  }
  if (shortcut.startsWith("Ctrl/Cmd+")) {
    const suffix = shortcut.slice("Ctrl/Cmd+".length);
    return `Control+${suffix} Meta+${suffix}`;
  }
  return shortcut.replaceAll("Ctrl+", "Control+").replaceAll("Cmd+", "Meta+");
}

/**
 * Closed command / Quick Action icon vocabulary (subset of AppIcon names).
 * Single source for `CommandIcon` — do not accept arbitrary strings as icons.
 */
export const COMMAND_ICONS = [
  "document",
  "new-document",
  "folder",
  "folder-open",
  "save",
  "close-all",
  "preview",
  "focus",
  "annotations",
  "outline",
  "search",
  "file-search",
  "undo",
  "redo",
  "cut",
  "copy",
  "paste",
  "replace",
] as const;

export type CommandIcon = (typeof COMMAND_ICONS)[number];

export function isCommandIcon(value: string): value is CommandIcon {
  return (COMMAND_ICONS as readonly string[]).includes(value);
}

export type CommandDefinition = {
  id: CommandId;
  label: string;
  shortcut?: string;
  icon?: CommandIcon;
};

/**
 * Semantic Quick Action groups (separators between groups).
 * Display order: {@link quickActionGroupOrder}.
 *
 * Groups describe the **user interaction model**, not feature ownership.
 * (e.g. Annotation is Edit/document in the toolbar; command ownership stays on the editor.)
 */
export type QuickActionGroup = "file" | "edit" | "search" | "fulvid";

/**
 * Semantic subgroups inside a group. Metadata only — no extra separators.
 */
export type QuickActionSubgroup =
  "document" | "workspace" | "history" | "clipboard" | "view" | "mode" | "panels";

/**
 * Overflow survival when the toolbar narrows.
 *
 * - `core` — keep longest
 * - `secondary` — next
 * - `overflow` — first into More
 *
 * Two independent axes:
 * - `order` — presentation within subgroup (toolbar / More)
 * - `overflowOrder` — leave order within the same tier (lower leaves first)
 *
 * Neither axis uses declaration-array position. Equal `overflowOrder` within a
 * tier falls back to command `id` only (no extra metadata field). Prefer unique
 * `overflowOrder` values per tier so that fallback never matters.
 * Show/Hide document annotations is View/Settings only; not a Quick Action.
 */
export type QuickActionTier = "core" | "secondary" | "overflow";

export type QuickActionDefinition = CommandDefinition & {
  group: QuickActionGroup;
  subgroup: QuickActionSubgroup;
  /** Presentation within the subgroup (lower = earlier). Independent of overflowOrder. */
  order: number;
  tier: QuickActionTier;
  /** Leave order within the same tier (lower = leaves first). Independent of order. */
  overflowOrder: number;
};

const handlers = new Map<CommandId, CommandHandler>();

/**
 * Declared Quick Actions. Classification is required for every entry.
 * This list is command metadata for the shell toolbar — not a generic registry.
 */
export const quickActions: readonly QuickActionDefinition[] = [
  {
    id: "newDocument",
    label: "actions.newDocument",
    shortcut: "Ctrl/Cmd+N",
    icon: "new-document",
    group: "file",
    subgroup: "document",
    order: 10,
    tier: "core",
    overflowOrder: 60,
  },
  {
    id: "openFile",
    label: "actions.openFile",
    shortcut: "Ctrl/Cmd+O",
    icon: "document",
    group: "file",
    subgroup: "document",
    order: 20,
    tier: "core",
    overflowOrder: 50,
  },
  {
    id: "save",
    label: "actions.save",
    shortcut: "Ctrl/Cmd+S",
    icon: "save",
    group: "file",
    subgroup: "document",
    order: 30,
    tier: "core",
    overflowOrder: 40,
  },
  {
    id: "closeAll",
    label: "tabs.closeAll",
    icon: "close-all",
    group: "file",
    subgroup: "workspace",
    order: 10,
    tier: "secondary",
    overflowOrder: 80,
  },
  {
    id: "openWorkspace",
    label: "actions.openWorkspace",
    icon: "folder-open",
    group: "file",
    subgroup: "workspace",
    order: 20,
    tier: "overflow",
    overflowOrder: 10,
  },
  {
    id: "annotateDocument",
    // Static key is Add; QuickActionsToolbar swaps Add/Edit from cursor state.
    label: "documentAnnotations.addTitle",
    icon: "annotations",
    group: "edit",
    subgroup: "document",
    order: 10,
    // Contextual Add/Edit on the current document — interaction is editing, not Fulvid chrome.
    tier: "secondary",
    overflowOrder: 50,
  },
  {
    id: "undo",
    label: "toolbar.undo",
    shortcut: "Ctrl/Cmd+Z",
    icon: "undo",
    group: "edit",
    subgroup: "history",
    order: 10,
    tier: "core",
    overflowOrder: 30,
  },
  {
    id: "redo",
    label: "toolbar.redo",
    shortcut: "Ctrl/Cmd+Shift+Z",
    icon: "redo",
    group: "edit",
    subgroup: "history",
    order: 20,
    tier: "core",
    overflowOrder: 20,
  },
  {
    id: "cut",
    label: "menu.cut",
    shortcut: "Ctrl/Cmd+X",
    icon: "cut",
    group: "edit",
    subgroup: "clipboard",
    order: 10,
    tier: "secondary",
    overflowOrder: 30,
  },
  {
    id: "copy",
    label: "menu.copy",
    shortcut: "Ctrl/Cmd+C",
    icon: "copy",
    group: "edit",
    subgroup: "clipboard",
    order: 20,
    tier: "secondary",
    overflowOrder: 20,
  },
  {
    id: "paste",
    label: "menu.paste",
    shortcut: "Ctrl/Cmd+V",
    icon: "paste",
    group: "edit",
    subgroup: "clipboard",
    order: 30,
    tier: "secondary",
    overflowOrder: 10,
  },
  {
    id: "find",
    label: "menu.find",
    shortcut: "Ctrl/Cmd+F",
    icon: "search",
    group: "search",
    subgroup: "document",
    order: 10,
    tier: "core",
    overflowOrder: 10,
  },
  {
    id: "replace",
    label: "menu.replace",
    shortcut: "Ctrl/Cmd+H",
    icon: "replace",
    group: "search",
    subgroup: "document",
    order: 20,
    tier: "secondary",
    overflowOrder: 70,
  },
  {
    id: "openGlobalSearch",
    label: "app.searchPanel",
    shortcut: "Ctrl/Cmd+Shift+F",
    icon: "file-search",
    group: "search",
    subgroup: "workspace",
    order: 10,
    tier: "overflow",
    overflowOrder: 30,
  },
  // Fulvid: app presentation / surfaces (not feature ownership of every command).
  // Presentation: view → mode → panels. Overflow leave: Explorer → Focus → Preview last.
  // Annotation lives in Edit/document; overflow stickiness still Preview > Annotation > Focus > Explorer.
  {
    id: "togglePreview",
    label: "actions.preview",
    icon: "preview",
    group: "fulvid",
    subgroup: "view",
    order: 10,
    // Document representation toggle; no QA shortcut — most persistent of the former Fulvid set.
    tier: "secondary",
    overflowOrder: 60,
  },
  {
    id: "toggleWritingFocus",
    label: "actions.focusMode",
    shortcut: "Ctrl/Cmd+Shift+Enter",
    icon: "focus",
    group: "fulvid",
    subgroup: "mode",
    order: 10,
    // Application presentation mode; shortcut + More remain (Focus keeps .quick-actions).
    tier: "secondary",
    overflowOrder: 40,
  },
  {
    id: "openExplorer",
    label: "actions.explorer",
    icon: "folder",
    group: "fulvid",
    subgroup: "panels",
    order: 10,
    // Panel visibility; Folder/left nav still cover navigation — first to leave.
    tier: "overflow",
    overflowOrder: 20,
  },
];

export const quickActionGroupOrder: readonly QuickActionGroup[] = [
  "file",
  "edit",
  "search",
  "fulvid",
];

const QUICK_ACTION_TIER_RANK: Record<QuickActionTier, number> = {
  core: 0,
  secondary: 1,
  overflow: 2,
};

const QUICK_ACTION_SUBGROUP_RANK: Record<
  QuickActionGroup,
  Partial<Record<QuickActionSubgroup, number>>
> = {
  file: { document: 0, workspace: 1 },
  edit: { document: 0, history: 1, clipboard: 2 },
  search: { document: 0, workspace: 1 },
  fulvid: { view: 0, mode: 1, panels: 2 },
};

function subgroupRank(action: QuickActionDefinition): number {
  return QUICK_ACTION_SUBGROUP_RANK[action.group][action.subgroup] ?? 99;
}

/** Toolbar and More-menu order within a group: subgroup, then `order`. */
export function compareQuickActionsByDisplay(
  left: QuickActionDefinition,
  right: QuickActionDefinition,
): number {
  return (
    subgroupRank(left) - subgroupRank(right) ||
    left.order - right.order ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Keep ranking for a button budget: lower tier rank first, then higher
 * `overflowOrder` (sticky) before lower (leave first).
 */
export function compareQuickActionsByKeepPriority(
  left: QuickActionDefinition,
  right: QuickActionDefinition,
): number {
  return (
    QUICK_ACTION_TIER_RANK[left.tier] - QUICK_ACTION_TIER_RANK[right.tier] ||
    right.overflowOrder - left.overflowOrder ||
    left.id.localeCompare(right.id)
  );
}

/**
 * Which Quick Actions stay visible for a given button budget.
 * Returns actions in group display order (not keep-rank order).
 */
export function selectQuickActionsForVisibleCount(
  actions: readonly QuickActionDefinition[],
  count: number,
): QuickActionDefinition[] {
  const budget = Math.max(0, Math.min(count, actions.length));
  const visibleIds = new Set(
    [...actions]
      .sort(compareQuickActionsByKeepPriority)
      .slice(0, budget)
      .map((action) => action.id),
  );
  return actions
    .filter((action) => visibleIds.has(action.id))
    .slice()
    .sort((left, right) => {
      const groupDelta =
        quickActionGroupOrder.indexOf(left.group) - quickActionGroupOrder.indexOf(right.group);
      return groupDelta || compareQuickActionsByDisplay(left, right);
    });
}

/** Actions for one group in More menu / toolbar strip order. */
export function orderQuickActionsInGroup(
  actions: readonly QuickActionDefinition[],
): QuickActionDefinition[] {
  return actions.slice().sort(compareQuickActionsByDisplay);
}

/**
 * Pages and App register handlers for CommandIds they own. Returns an
 * unregister function for unmount. The registry is a dispatch table, not a
 * second store or navigation system.
 */
export function registerCommandHandler(id: CommandId, handler: CommandHandler): () => void {
  handlers.set(id, handler);
  return () => {
    if (handlers.get(id) === handler) {
      handlers.delete(id);
    }
  };
}

export function hasCommandHandler(id: CommandId): boolean {
  return handlers.has(id);
}

/** Wait for a lazy-loaded page to register its handler after navigation. */
export async function waitForCommandHandler(id: CommandId, timeoutMs = 3000): Promise<boolean> {
  if (handlers.has(id)) {
    return true;
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (handlers.has(id)) {
      return true;
    }
  }

  return false;
}

/**
 * Run a Shell command if the owning surface has registered a handler.
 *
 * Missing handlers are no-ops: menus and shortcuts stay available while a
 * page that owns the action is not mounted (for example Save on Graph).
 */
export async function executeCommand(id: CommandId): Promise<void> {
  await handlers.get(id)?.();
}
