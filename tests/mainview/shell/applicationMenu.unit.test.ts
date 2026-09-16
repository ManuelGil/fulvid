import { describe, expect, test } from "bun:test";

import {
  ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED,
  electrobunApplicationMenuFallbackReason,
  electrobunNativeApplicationMenuSupported,
} from "../../../src/mainview/desktop/electrobunApplicationMenu.ts";
import {
  menuItemEnabled,
  presentApplicationMenu,
  presentedMenuAction,
  type ApplicationMenuState,
} from "../../../src/mainview/shell/applicationMenu/applicationMenuModel.ts";

const idleState: ApplicationMenuState = {
  hasActiveDocument: false,
  isVirtualDocument: false,
  hasDocumentPath: false,
  isDocumentDirty: false,
  tabCount: 0,
  hasFolder: false,
  previewEnabled: false,
  leftSidebarOpen: true,
  rightSidebarOpen: false,
  statusbarEnabled: true,
  writingFocus: false,
  documentAnnotationsVisible: true,
  canUndo: false,
  canRedo: false,
};

// Intent: Save follows document identity, not Folder. Quit is a command so dirty
// buffers can be confirmed. Extensions live under File. Full Screen shortcuts are
// platform-specific (Ctrl≠Cmd). Linux native menu is Electrobun's limit.
describe("application menu", () => {
  test("Save, Quit, Extensions, and Full Screen follow product ownership rules", () => {
    expect(menuItemEnabled("canSave", idleState)).toBe(false);
    expect(
      menuItemEnabled("canSave", {
        ...idleState,
        hasActiveDocument: true,
        isVirtualDocument: true,
      }),
    ).toBe(true);
    expect(
      menuItemEnabled("canSave", {
        ...idleState,
        hasActiveDocument: true,
        isDocumentDirty: true,
      }),
    ).toBe(true);
    expect(
      menuItemEnabled("canSave", {
        ...idleState,
        hasActiveDocument: true,
      }),
    ).toBe(false);
    expect(menuItemEnabled("hasFolder", idleState)).toBe(false);

    const darwin = presentApplicationMenu("darwin", idleState, (key) => key);
    const app = darwin.find((menu) => menu.id === "app");
    const darwinQuit = app?.items.find((item) => item.type === "command" && item.id === "quit");
    expect(darwinQuit?.type).toBe("command");
    if (darwinQuit?.type === "command") {
      expect(presentedMenuAction(darwinQuit)).toBe("quit");
    }
    expect(app?.items.some((item) => item.type === "role" && item.role === "quit")).toBe(false);

    const win = presentApplicationMenu("win32", idleState, (key) => key);
    const file = win.find((menu) => menu.id === "file");
    const winQuit = file?.items.find((item) => item.type === "command" && item.id === "quit");
    expect(winQuit?.type).toBe("command");
    if (winQuit?.type === "command") {
      expect(presentedMenuAction(winQuit)).toBe("quit");
    }

    const linuxMenus = presentApplicationMenu("linux", idleState, (key) => key);
    expect(linuxMenus.some((menu) => menu.id === "extensions")).toBe(false);
    const linuxFile = linuxMenus.find((menu) => menu.id === "file");
    const openExtensions = linuxFile?.items.find(
      (item) => item.type === "command" && item.id === "openExtensions",
    );
    expect(openExtensions?.type).toBe("command");
    if (openExtensions?.type === "command") {
      expect(presentedMenuAction(openExtensions)).toBe("openExtensions");
      expect(openExtensions.label).toBe("menu.extensions");
    }

    const winView = win.find((menu) => menu.id === "view");
    const winFullscreen = winView?.items.find(
      (item) => item.type === "command" && item.id === "toggleFullscreen",
    );
    expect(winFullscreen?.type).toBe("command");
    if (winFullscreen?.type === "command") {
      expect(presentedMenuAction(winFullscreen)).toBe("toggleFullscreen");
      // Windows/Linux use F11; this is not "Ctrl as Cmd".
      expect(winFullscreen.shortcut).toBe("F11");
    }
    expect(
      winView?.items.some((item) => item.type === "role" && item.id === "toggleFullScreen"),
    ).toBe(false);

    const darwinView = darwin.find((menu) => menu.id === "view");
    const darwinFullscreen = darwinView?.items.find(
      (item) => item.type === "command" && item.id === "toggleFullscreen",
    );
    expect(darwinFullscreen?.type).toBe("command");
    if (darwinFullscreen?.type === "command") {
      // macOS Full Screen is Control+Command+F - not primary-mod equivalence with Ctrl.
      expect(darwinFullscreen.shortcut).toBe("Ctrl+Cmd+F");
    }
  });

  test("Linux is an HTML fallback and Edit role item ids stay unique", () => {
    expect(electrobunNativeApplicationMenuSupported("linux")).toBe(false);
    expect(electrobunApplicationMenuFallbackReason("linux")).toBe(
      ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED,
    );
    expect(electrobunNativeApplicationMenuSupported("darwin")).toBe(true);
    expect(electrobunNativeApplicationMenuSupported("win32")).toBe(true);

    const menus = presentApplicationMenu("linux", idleState, (key) => key);
    const edit = menus.find((menu) => menu.id === "edit");
    expect(edit).toBeDefined();
    const ids = (edit?.items ?? [])
      .filter((item) => item.type !== "separator")
      .map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
    const paste = edit?.items.find((item) => item.type === "role" && item.role === "paste");
    const pasteMatch = edit?.items.find(
      (item) => item.type === "role" && item.role === "pasteAndMatchStyle",
    );
    expect(paste?.type).toBe("role");
    expect(pasteMatch?.type).toBe("role");
    if (paste?.type === "role" && pasteMatch?.type === "role") {
      expect(paste.id).toBe("paste");
      expect(pasteMatch.id).toBe("pasteAndMatchStyle");
      expect(presentedMenuAction(paste)).toBe("paste");
      expect(presentedMenuAction(pasteMatch)).toBe("paste");
    }
  });
});
