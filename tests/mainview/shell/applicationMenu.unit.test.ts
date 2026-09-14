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

// Intent: Save follows document identity; Full Screen is an explicit command; Linux is HTML fallback.
describe("application menu", () => {
  test("enables Save from document identity and exposes Full Screen as an explicit command", () => {
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
      }),
    ).toBe(false);

    const menus = presentApplicationMenu("win32", idleState, (key) => key);
    const view = menus.find((menu) => menu.id === "view");
    const fullscreen = view?.items.find(
      (item) => item.type === "command" && item.id === "toggleFullscreen",
    );
    expect(fullscreen?.type).toBe("command");
    if (fullscreen?.type === "command") {
      expect(presentedMenuAction(fullscreen)).toBe("toggleFullscreen");
    }
    expect(view?.items.some((item) => item.type === "role" && item.id === "toggleFullScreen")).toBe(
      false,
    );
  });

  test("treats Linux as an HTML fallback in Electrobun 2.0.1", () => {
    expect(electrobunNativeApplicationMenuSupported("linux")).toBe(false);
    expect(electrobunApplicationMenuFallbackReason("linux")).toBe(
      ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED,
    );
    expect(electrobunNativeApplicationMenuSupported("darwin")).toBe(true);
  });
});
