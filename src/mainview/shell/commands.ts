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
  | "openExplorer"
  | "openEditor"
  | "openGraph"
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

export type CommandIcon =
  | "document"
  | "new-document"
  | "folder"
  | "folder-open"
  | "save"
  | "close-all"
  | "preview"
  | "outline"
  | "search"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "replace";

export type CommandDefinition = {
  id: CommandId;
  label: string;
  shortcut?: string;
  icon?: CommandIcon;
};

export type QuickActionGroup = "file" | "edit" | "search" | "fulvid";

export type QuickActionTier = "core" | "secondary" | "overflow";

export type QuickActionDefinition = CommandDefinition & {
  group: QuickActionGroup;
  tier: QuickActionTier;
};

const handlers = new Map<CommandId, CommandHandler>();

export const quickActions: readonly QuickActionDefinition[] = [
  {
    id: "newDocument",
    label: "actions.newDocument",
    shortcut: "Ctrl/Cmd+N",
    icon: "new-document",
    group: "file",
    tier: "core",
  },
  {
    id: "openFile",
    label: "actions.openFile",
    shortcut: "Ctrl/Cmd+O",
    icon: "document",
    group: "file",
    tier: "core",
  },
  {
    id: "save",
    label: "actions.save",
    shortcut: "Ctrl/Cmd+S",
    icon: "save",
    group: "file",
    tier: "core",
  },
  {
    id: "closeAll",
    label: "tabs.closeAll",
    icon: "close-all",
    group: "file",
    tier: "secondary",
  },
  {
    id: "undo",
    label: "toolbar.undo",
    shortcut: "Ctrl/Cmd+Z",
    icon: "undo",
    group: "edit",
    tier: "core",
  },
  {
    id: "redo",
    label: "toolbar.redo",
    shortcut: "Ctrl/Cmd+Shift+Z",
    icon: "redo",
    group: "edit",
    tier: "core",
  },
  {
    id: "cut",
    label: "menu.cut",
    shortcut: "Ctrl/Cmd+X",
    icon: "cut",
    group: "edit",
    tier: "secondary",
  },
  {
    id: "copy",
    label: "menu.copy",
    shortcut: "Ctrl/Cmd+C",
    icon: "copy",
    group: "edit",
    tier: "secondary",
  },
  {
    id: "paste",
    label: "menu.paste",
    shortcut: "Ctrl/Cmd+V",
    icon: "paste",
    group: "edit",
    tier: "secondary",
  },
  {
    id: "find",
    label: "menu.find",
    shortcut: "Ctrl/Cmd+F",
    icon: "search",
    group: "search",
    tier: "core",
  },
  {
    id: "replace",
    label: "menu.replace",
    shortcut: "Ctrl/Cmd+H",
    icon: "replace",
    group: "search",
    tier: "secondary",
  },
  {
    id: "togglePreview",
    label: "actions.preview",
    icon: "preview",
    group: "fulvid",
    tier: "secondary",
  },
  {
    id: "openGlobalSearch",
    label: "app.searchPanel",
    shortcut: "Ctrl/Cmd+P",
    icon: "search",
    group: "search",
    tier: "overflow",
  },
  {
    id: "openExplorer",
    label: "actions.explorer",
    icon: "folder",
    group: "fulvid",
    tier: "overflow",
  },
  {
    id: "openWorkspace",
    label: "actions.openWorkspace",
    icon: "folder-open",
    group: "file",
    tier: "overflow",
  },
];

export const quickActionGroupOrder: readonly QuickActionGroup[] = [
  "file",
  "edit",
  "search",
  "fulvid",
];

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
