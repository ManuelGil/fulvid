import { describe, expect, test } from "bun:test";
import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { resolveAppIconName } from "../../src/mainview/shell/appIcons.ts";
import { COMMAND_ICONS, isCommandIcon, quickActions } from "../../src/mainview/shell/commands.ts";
import { WRITING_FOCUS_KEPT_SELECTORS } from "../../src/mainview/modules/editor/writingFocus.ts";

const EXTENSIONS_ROOT = join(import.meta.dir, "../../extensions");

type FixtureManifest = {
  capabilities: string[];
  commands?: Array<Record<string, unknown>>;
};

async function readManifest(id: string): Promise<FixtureManifest> {
  return JSON.parse(
    await readFile(join(EXTENSIONS_ROOT, id, "manifest.json"), "utf8"),
  ) as FixtureManifest;
}

// Intent: presentation may gain seams later; authority must not travel with UI.
// Growth boundary: real contribution/icon contracts only — not product UI coverage.
describe("extension UI boundary", () => {
  test("rejects unknown application icon identifiers", () => {
    expect(resolveAppIconName("focus")).toBe("focus");
    expect(resolveAppIconName("missing-icon")).toBeNull();
    expect(resolveAppIconName("<svg/onload=1>")).toBeNull();
    expect(resolveAppIconName("javascript:alert(1)")).toBeNull();
  });

  test("keeps command icons inside the closed AppIcon set", () => {
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

  test("keeps Quick Actions usable in Writing Focus without inventing overlay chrome", () => {
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".quick-actions");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain("[data-application-menu]");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".toast-host");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".dialog-host");
  });

  test("fixture commands stay host actions without UI injection fields", async () => {
    const dirs = (await readdir(EXTENSIONS_ROOT, { withFileTypes: true }))
      .filter((entry) => entry.isDirectory() && entry.name.startsWith("local."))
      .map((entry) => entry.name)
      .sort();
    expect(dirs).toEqual(["local.capability-notify", "local.declarative-pack"]);

    for (const id of dirs) {
      const manifest = await readManifest(id);
      expect(manifest.capabilities).not.toContain("monaco");
      expect(manifest.capabilities).not.toContain("filesystem");
      for (const command of manifest.commands ?? []) {
        expect(command).not.toHaveProperty("html");
        expect(command).not.toHaveProperty("svg");
        expect(command).not.toHaveProperty("component");
        expect(command).not.toHaveProperty("placement");
        expect(command).not.toHaveProperty("monaco");
        expect(command).not.toHaveProperty("fs");
      }
    }
  });
});
