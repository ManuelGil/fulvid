import { describe, expect, test } from "bun:test";

import { resolveAppIconName } from "../../src/mainview/shell/appIcons.ts";
import { COMMAND_ICONS, isCommandIcon, quickActions } from "../../src/mainview/shell/commands.ts";
import { WRITING_FOCUS_KEPT_SELECTORS } from "../../src/mainview/modules/editor/writingFocus.ts";

// Intent: presentation may gain seams later; authority must not travel with UI.
// Pack surface denial (monaco/filesystem/html injection) lives in extensionFixtures.
describe("extension UI boundary", () => {
  test("rejects arbitrary application icon identifiers", () => {
    expect(resolveAppIconName("focus")).toBe("focus");
    expect(resolveAppIconName("missing-icon")).toBeNull();
    expect(resolveAppIconName("<svg/onload=1>")).toBeNull();
    expect(resolveAppIconName("javascript:alert(1)")).toBeNull();
  });

  test("keeps command icons inside the closed AppIcon vocabulary", () => {
    for (const icon of COMMAND_ICONS) {
      expect(isCommandIcon(icon)).toBe(true);
      expect(resolveAppIconName(icon)).toBe(icon);
    }
    expect(isCommandIcon("not-an-icon")).toBe(false);
    expect(isCommandIcon("<svg onclick=alert(1)>")).toBe(false);

    for (const action of quickActions) {
      if (action.icon) {
        expect(isCommandIcon(action.icon)).toBe(true);
      }
    }
  });

  test("keeps Quick Actions usable during Writing Focus", () => {
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".quick-actions");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain("[data-application-menu]");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".toast-host");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".dialog-host");
  });
});
