import { describe, expect, test } from "bun:test";

import { resolveAppIconName } from "../../../src/mainview/shell/appIcons.ts";
import {
  COMMAND_ICONS,
  isCommandIcon,
  quickActions,
} from "../../../src/mainview/shell/commands.ts";

/** Closed icon vocabulary - not extension-surface coverage. */
describe("application icons", () => {
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
    for (const action of quickActions) {
      if (action.icon) {
        expect(isCommandIcon(action.icon)).toBe(true);
      }
    }
  });
});
