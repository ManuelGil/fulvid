/**
 * Single Application Menu model for native Electrobun and the HTML fallback.
 * Commands stay in `commands.ts`; this file only describes presentation.
 */
import { MARKDOWN_COMMANDS } from "../../modules/editor/markdown/markdownFormat";
import type { DesktopPlatform } from "../../desktop/desktopRpc";
import type { CommandId } from "../commands";

export type MenuAvailability =
  | "always"
  | "hasDocument"
  | "canSave"
  | "canSaveAs"
  | "hasTab"
  | "hasMultipleTabs"
  | "hasDocumentPath"
  | "hasFolder"
  | "canUndo"
  | "canRedo";

export type ApplicationMenuRole =
  | "about"
  | "quit"
  | "hide"
  | "hideOthers"
  | "showAll"
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "pasteAndMatchStyle"
  | "delete"
  | "selectAll";

export type ApplicationMenuState = {
  hasActiveDocument: boolean;
  isVirtualDocument: boolean;
  hasDocumentPath: boolean;
  isDocumentDirty: boolean;
  tabCount: number;
  hasFolder: boolean;
  previewEnabled: boolean;
  leftSidebarOpen: boolean;
  rightSidebarOpen: boolean;
  statusbarEnabled: boolean;
  writingFocus: boolean;
  documentAnnotationsVisible: boolean;
  canUndo: boolean;
  canRedo: boolean;
};

export type ApplicationMenuNode =
  | { type: "separator"; id: string }
  | {
      type: "command";
      id: CommandId;
      label: string;
      shortcut?: string;
      accelerator?: string;
      availability: MenuAvailability;
      checked?:
        | "preview"
        | "leftSidebar"
        | "rightSidebar"
        | "statusbar"
        | "writingFocus"
        | "documentAnnotations";
    }
  | {
      type: "role";
      id: string;
      role: ApplicationMenuRole;
      label: string;
      fallbackCommand?: CommandId;
    }
  | {
      type: "submenu";
      id: string;
      label: string;
      items: readonly ApplicationMenuNode[];
    };

export type ApplicationMenuBar = {
  id: string;
  label: string;
  items: readonly ApplicationMenuNode[];
};

export type PresentedMenuItem =
  | { type: "separator"; id: string }
  | {
      type: "command";
      id: CommandId;
      label: string;
      shortcut?: string;
      accelerator?: string;
      enabled: boolean;
      checked?: boolean;
    }
  | {
      type: "role";
      id: string;
      role: ApplicationMenuRole;
      label: string;
      fallbackCommand?: CommandId;
      enabled: boolean;
    }
  | {
      type: "submenu";
      id: string;
      label: string;
      items: readonly PresentedMenuItem[];
    };

export type PresentedMenuBar = {
  id: string;
  label: string;
  items: readonly PresentedMenuItem[];
};

const FORMAT_ITEMS: ApplicationMenuNode[] = MARKDOWN_COMMANDS.map((command) => ({
  type: "command" as const,
  id: command.id,
  label: `markdown.${command.action}`,
  shortcut: "shortcut" in command ? command.shortcut : undefined,
  availability: "hasDocument" as const,
}));

export function menuItemEnabled(
  availability: MenuAvailability,
  state: ApplicationMenuState,
): boolean {
  switch (availability) {
    case "always":
      return true;
    case "hasDocument":
      return state.hasActiveDocument;
    case "canSave":
      return state.hasActiveDocument && (state.isVirtualDocument || state.isDocumentDirty);
    case "canSaveAs":
      return state.hasActiveDocument;
    case "hasTab":
      return state.tabCount > 0;
    case "hasMultipleTabs":
      return state.tabCount > 1;
    case "hasDocumentPath":
      return state.hasDocumentPath;
    case "hasFolder":
      return state.hasFolder;
    case "canUndo":
      return state.canUndo;
    case "canRedo":
      return state.canRedo;
  }
}

function checkedFor(
  key:
    | "preview"
    | "leftSidebar"
    | "rightSidebar"
    | "statusbar"
    | "writingFocus"
    | "documentAnnotations"
    | undefined,
  state: ApplicationMenuState,
): boolean | undefined {
  if (key === "preview") {
    return state.previewEnabled;
  }
  if (key === "leftSidebar") {
    return state.leftSidebarOpen;
  }
  if (key === "rightSidebar") {
    return state.rightSidebarOpen;
  }
  if (key === "statusbar") {
    return state.statusbarEnabled;
  }
  if (key === "writingFocus") {
    return state.writingFocus;
  }
  if (key === "documentAnnotations") {
    return state.documentAnnotationsVisible;
  }
  return undefined;
}

function commandLabel(id: CommandId, label: string, state: ApplicationMenuState): string {
  if (id === "togglePreview") {
    return state.previewEnabled ? "actions.hidePreview" : "actions.preview";
  }
  if (id === "toggleDocumentAnnotations") {
    return state.documentAnnotationsVisible ? "actions.hideAnnotations" : "actions.showAnnotations";
  }
  if (id === "toggleWritingFocus") {
    return state.writingFocus ? "actions.exitFocusMode" : "actions.focusMode";
  }
  return label;
}

function roleEnabled(role: ApplicationMenuRole, state: ApplicationMenuState): boolean {
  if (role === "undo") {
    return state.canUndo;
  }
  if (role === "redo") {
    return state.canRedo;
  }
  if (
    role === "cut" ||
    role === "copy" ||
    role === "paste" ||
    role === "pasteAndMatchStyle" ||
    role === "delete" ||
    role === "selectAll"
  ) {
    return state.hasActiveDocument;
  }
  return true;
}

export function applicationMenuTemplate(platform: DesktopPlatform): readonly ApplicationMenuBar[] {
  const appMenu: ApplicationMenuBar = {
    id: "app",
    label: "app.product",
    items: [
      {
        type: "role",
        id: "about",
        role: "about",
        label: "menu.aboutFulvid",
        fallbackCommand: "openAbout",
      },
      { type: "separator", id: "app-separator-1" },
      { type: "role", id: "hide", role: "hide", label: "menu.hide" },
      { type: "role", id: "hideOthers", role: "hideOthers", label: "menu.hideOthers" },
      { type: "role", id: "showAll", role: "showAll", label: "menu.showAll" },
      { type: "separator", id: "app-separator-2" },
      { type: "role", id: "quit", role: "quit", label: "menu.quit", fallbackCommand: "quit" },
    ],
  };

  const fileItems: ApplicationMenuNode[] = [
    {
      type: "submenu",
      id: "new",
      label: "menu.new",
      items: [
        {
          type: "command",
          id: "newDocument",
          label: "actions.newDocument",
          shortcut: "Ctrl/Cmd+N",
          accelerator: "n",
          availability: "always",
        },
        {
          type: "command",
          id: "newDocumentFromReadme",
          label: "actions.newDocumentFromReadme",
          availability: "always",
        },
        {
          type: "command",
          id: "newDocumentFromSelection",
          label: "actions.newDocumentFromSelection",
          availability: "hasTab",
        },
      ],
    },
    { type: "separator", id: "file-separator-new" },
    {
      type: "submenu",
      id: "open",
      label: "menu.open",
      items: [
        {
          type: "command",
          id: "openFile",
          label: "menu.openFile",
          shortcut: "Ctrl/Cmd+O",
          accelerator: "o",
          availability: "always",
        },
        {
          type: "command",
          id: "openWorkspace",
          label: "menu.openFolder",
          availability: "always",
        },
      ],
    },
    { type: "separator", id: "file-separator-open" },
    {
      type: "command",
      id: "save",
      label: "actions.save",
      shortcut: "Ctrl/Cmd+S",
      accelerator: "s",
      availability: "canSave",
    },
    {
      type: "command",
      id: "saveAs",
      label: "actions.saveAs",
      shortcut: "Ctrl/Cmd+Shift+S",
      availability: "canSaveAs",
    },
    {
      type: "command",
      id: "exportHtml",
      label: "actions.exportHtml",
      availability: "canSaveAs",
    },
    { type: "separator", id: "file-separator-save" },
    {
      type: "command",
      id: "closeDocument",
      label: "menu.closeDocument",
      shortcut: "Ctrl/Cmd+W",
      accelerator: "w",
      availability: "hasTab",
    },
    {
      type: "command",
      id: "closeOthers",
      label: "tabs.closeOthers",
      shortcut: "Ctrl/Cmd+Alt+W",
      availability: "hasMultipleTabs",
    },
    { type: "separator", id: "file-separator-tabs" },
    {
      type: "command",
      id: "revealDocument",
      label: "menu.revealInFolder",
      availability: "hasDocumentPath",
    },
    {
      type: "command",
      id: "copyDocumentPath",
      label: "menu.copyPath",
      availability: "hasDocumentPath",
    },
    { type: "separator", id: "file-separator-path" },
    {
      type: "command",
      id: "closeWorkspace",
      label: "menu.closeWorkspace",
      availability: "hasFolder",
    },
    {
      type: "command",
      id: "refreshWorkspace",
      label: "actions.refresh",
      availability: "hasFolder",
    },
    { type: "separator", id: "file-separator-folder" },
    {
      type: "command",
      id: "openSettings",
      label: "nav.settings",
      availability: "always",
    },
  ];

  if (platform !== "darwin") {
    fileItems.push(
      { type: "separator", id: "file-separator-3" },
      { type: "role", id: "quit", role: "quit", label: "menu.quit", fallbackCommand: "quit" },
    );
  }

  const menus: ApplicationMenuBar[] = [
    {
      id: "file",
      label: "menu.file",
      items: fileItems,
    },
    {
      id: "edit",
      label: "menu.edit",
      items: [
        { type: "role", id: "undo", role: "undo", label: "toolbar.undo", fallbackCommand: "undo" },
        { type: "role", id: "redo", role: "redo", label: "toolbar.redo", fallbackCommand: "redo" },
        { type: "separator", id: "edit-separator-1" },
        { type: "role", id: "cut", role: "cut", label: "menu.cut", fallbackCommand: "cut" },
        { type: "role", id: "copy", role: "copy", label: "menu.copy", fallbackCommand: "copy" },
        { type: "role", id: "paste", role: "paste", label: "menu.paste", fallbackCommand: "paste" },
        {
          type: "role",
          id: "pasteAndMatchStyle",
          role: "pasteAndMatchStyle",
          label: "menu.pasteAndMatchStyle",
          fallbackCommand: "paste",
        },
        {
          type: "role",
          id: "delete",
          role: "delete",
          label: "menu.delete",
          fallbackCommand: "deleteSelection",
        },
        {
          type: "role",
          id: "selectAll",
          role: "selectAll",
          label: "menu.selectAll",
          fallbackCommand: "selectAll",
        },
        { type: "separator", id: "edit-separator-2" },
        {
          type: "command",
          id: "find",
          label: "menu.find",
          shortcut: "Ctrl/Cmd+F",
          accelerator: "f",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "replace",
          label: "menu.replace",
          shortcut: "Ctrl/Cmd+H",
          accelerator: "h",
          availability: "hasDocument",
        },
        { type: "separator", id: "edit-separator-3" },
        {
          type: "command",
          id: "indentLines",
          label: "menu.indentLines",
          shortcut: "Tab",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "outdentLines",
          label: "menu.outdentLines",
          shortcut: "Shift+Tab",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "duplicateSelection",
          label: "menu.duplicateSelection",
          shortcut: "Ctrl/Cmd+Shift+D",
          availability: "hasDocument",
        },
        {
          type: "submenu",
          id: "format",
          label: "menu.format",
          items: FORMAT_ITEMS,
        },
        { type: "separator", id: "edit-separator-format" },
        {
          type: "command",
          id: "insertDocumentLink",
          label: "actions.insertDocumentLink",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "insertTableOfContents",
          label: "actions.insertTableOfContents",
          availability: "hasDocument",
        },
      ],
    },
    {
      id: "view",
      label: "menu.view",
      items: [
        {
          type: "submenu",
          id: "panels",
          label: "menu.panels",
          items: [
            { type: "command", id: "openEditor", label: "nav.editor", availability: "always" },
            {
              type: "command",
              id: "openGlobalSearch",
              label: "nav.search",
              shortcut: "Ctrl/Cmd+Shift+F",
              availability: "always",
            },
            { type: "command", id: "openGraph", label: "nav.graph", availability: "always" },
            { type: "command", id: "openSettings", label: "nav.settings", availability: "always" },
          ],
        },
        { type: "separator", id: "view-separator-1" },
        {
          type: "command",
          id: "openOutline",
          label: "actions.outline",
          shortcut: "Ctrl/Cmd+Shift+O",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "togglePreview",
          label: "actions.preview",
          availability: "always",
          checked: "preview",
        },
        {
          type: "command",
          id: "toggleDocumentAnnotations",
          label: "actions.showAnnotations",
          availability: "always",
          checked: "documentAnnotations",
        },
        {
          type: "command",
          id: "toggleWritingFocus",
          label: "menu.focusMode",
          shortcut: "Ctrl/Cmd+Shift+Enter",
          availability: "always",
          checked: "writingFocus",
        },
        { type: "separator", id: "view-separator-2" },
        {
          type: "submenu",
          id: "sidebars",
          label: "menu.sidebars",
          items: [
            {
              type: "command",
              id: "toggleLeftSidebar",
              label: "menu.leftSidebar",
              availability: "always",
              checked: "leftSidebar",
            },
            {
              type: "command",
              id: "toggleRightSidebar",
              label: "menu.rightSidebar",
              availability: "always",
              checked: "rightSidebar",
            },
          ],
        },
        {
          type: "command",
          id: "toggleStatusbar",
          label: "menu.statusbar",
          availability: "always",
          checked: "statusbar",
        },
        { type: "separator", id: "view-separator-3" },
        {
          type: "command",
          id: "toggleFullscreen",
          label: "menu.fullscreen",
          shortcut: platform === "darwin" ? "Ctrl+Cmd+F" : "F11",
          accelerator: platform === "darwin" ? undefined : "F11",
          availability: "always",
        },
      ],
    },
    {
      id: "navigate",
      label: "menu.navigate",
      items: [
        {
          type: "submenu",
          id: "tabs",
          label: "menu.tabs",
          items: [
            {
              type: "command",
              id: "nextTab",
              label: "menu.nextTab",
              availability: "hasMultipleTabs",
            },
            {
              type: "command",
              id: "previousTab",
              label: "menu.previousTab",
              availability: "hasMultipleTabs",
            },
          ],
        },
        { type: "separator", id: "navigate-separator-document" },
        {
          type: "command",
          id: "openQuickOpen",
          label: "actions.quickOpen",
          shortcut: "Ctrl/Cmd+P",
          accelerator: "p",
          availability: "always",
        },
        {
          type: "command",
          id: "findReferences",
          label: "actions.findReferences",
          shortcut: "Shift+F12",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "renameHeading",
          label: "actions.renameHeading",
          shortcut: "F2",
          availability: "hasDocument",
        },
        { type: "separator", id: "navigate-separator-annotations" },
        {
          type: "command",
          id: "annotateDocument",
          label: "documentAnnotations.annotate",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "removeAnnotation",
          label: "documentAnnotations.remove",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "nextAnnotation",
          label: "documentAnnotations.next",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "previousAnnotation",
          label: "documentAnnotations.previous",
          availability: "hasDocument",
        },
        {
          type: "command",
          id: "clearAnnotations",
          label: "documentAnnotations.clear",
          availability: "hasDocument",
        },
      ],
    },
    {
      id: "help",
      label: "menu.help",
      items:
        platform === "darwin"
          ? [
              {
                type: "command",
                id: "openKeyboardShortcuts",
                label: "menu.keyboardShortcuts",
                availability: "always",
              },
            ]
          : [
              {
                type: "command",
                id: "openKeyboardShortcuts",
                label: "menu.keyboardShortcuts",
                availability: "always",
              },
              {
                type: "role",
                id: "help-about",
                role: "about",
                label: "menu.aboutFulvid",
                fallbackCommand: "openAbout",
              },
            ],
    },
  ];

  return platform === "darwin" ? [appMenu, ...menus] : menus;
}

export function presentApplicationMenu(
  platform: DesktopPlatform,
  state: ApplicationMenuState,
  translate: (key: string) => string,
): PresentedMenuBar[] {
  return applicationMenuTemplate(platform).map((menu) => ({
    id: menu.id,
    label: translate(menu.label),
    items: presentItems(menu.items, state, translate),
  }));
}

function presentItems(
  items: readonly ApplicationMenuNode[],
  state: ApplicationMenuState,
  translate: (key: string) => string,
): PresentedMenuItem[] {
  return items.map((item) => {
    if (item.type === "separator") {
      return item;
    }
    if (item.type === "submenu") {
      return {
        type: "submenu",
        id: item.id,
        label: translate(item.label),
        items: presentItems(item.items, state, translate),
      };
    }
    if (item.type === "role") {
      return {
        type: "role",
        id: item.id,
        role: item.role,
        label: translate(item.label),
        fallbackCommand: item.fallbackCommand,
        enabled: roleEnabled(item.role, state),
      };
    }
    return {
      type: "command",
      id: item.id,
      label: translate(commandLabel(item.id, item.label, state)),
      shortcut: item.shortcut,
      accelerator: item.accelerator,
      enabled: menuItemEnabled(item.availability, state),
      checked: checkedFor(item.checked, state),
    };
  });
}

export function presentedMenuAction(item: PresentedMenuItem): CommandId | null {
  if (item.type === "command") {
    return item.id;
  }
  if (item.type === "role") {
    return item.fallbackCommand ?? null;
  }
  return null;
}
