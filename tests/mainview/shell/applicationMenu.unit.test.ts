import { describe, expect, test } from "bun:test";

import {
  ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED,
  electrobunApplicationMenuFallbackReason,
  electrobunNativeApplicationMenuSupported,
} from "../../../src/mainview/desktop/electrobunApplicationMenu.ts";
import {
  menuItemEnabled,
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
  canUndo: false,
  canRedo: false,
};

// Intent: Save follows document identity, not Folder. Linux native menu is Electrobun's limit.
// Growth boundary: add a case only if availability or save-enablement rules change.
describe("application menu", () => {
  test("enables Save from document identity, not Folder", () => {
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
  });

  test("treats Linux as an HTML fallback in Electrobun 2.0.1", () => {
    expect(electrobunNativeApplicationMenuSupported("linux")).toBe(false);
    expect(electrobunApplicationMenuFallbackReason("linux")).toBe(
      ELECTROBUN_LINUX_APPLICATION_MENU_UNWIRED,
    );
    expect(electrobunNativeApplicationMenuSupported("darwin")).toBe(true);
    expect(electrobunNativeApplicationMenuSupported("win32")).toBe(true);
  });
});
