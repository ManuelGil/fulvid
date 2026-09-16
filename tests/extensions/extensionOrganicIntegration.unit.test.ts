import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  loadAllowedBlockedExtension,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import { resetExtensionAllowancesForTests } from "../../src/bun/extensions/extensionAllowances.ts";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";
import { integrateExtensionActionsIntoMenus } from "../../src/mainview/shell/applicationMenu/applicationMenuModel.ts";
import { resetExtensionRegistryForTests } from "../../src/mainview/extensions/extensionRegistry.ts";

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-organic-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writePack(
  root: string,
  id: string,
  manifest: unknown,
  entry = `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    ui.notify("ok")
  end
})
`,
): Promise<void> {
  const pack = join(root, id);
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(pack, "entry.lua"), entry);
}

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionRegistryForTests();
  resetExtensionAllowancesForTests();
});

describe("manifest menu placement and organic integration", () => {
  test("accepts closed menu targets; rejects invalid menus and missing documentAction; File->New only", () => {
    const accepted = validateExtensionManifest({
      ...luaManifest("imgildev.todo-decorator", [
        "lua",
        "commands",
        "ui",
        "document",
        "decorations",
      ]),
      activation: "document",
      documentAction: "todoRefresh",
      actions: [
        { id: "todoNext", menu: "navigate", order: 1, title: "Next TODO" },
        { id: "todoPrevious", menu: "navigate", order: 2 },
      ],
    });
    expect("manifest" in accepted).toBe(true);
    if ("manifest" in accepted) {
      expect(accepted.manifest.activation).toBe("document");
      expect(accepted.manifest.documentAction).toBe("todoRefresh");
    }

    expect(
      validateExtensionManifest({
        ...luaManifest("test.bad-menu"),
        actions: [{ id: "ping", menu: "extensions" }],
      }),
    ).toEqual({
      reason: "invalid menu target: extensions (allowed: file.new, edit, view, navigate, help)",
    });

    expect(
      validateExtensionManifest({
        ...luaManifest("test.bad-doc", ["lua", "commands", "ui", "document", "decorations"]),
        activation: "document",
      }),
    ).toEqual({
      reason:
        "document activation requires documentAction (Lua command id re-invoked on buffer changes)",
    });

    const menus = integrateExtensionActionsIntoMenus(
      [
        {
          id: "file",
          label: "File",
          items: [
            {
              type: "submenu",
              id: "new",
              label: "New",
              items: [{ type: "command", id: "newDocument", label: "Untitled", enabled: true }],
            },
          ],
        },
        { id: "edit", label: "Edit", items: [] },
      ],
      [
        {
          namespacedId: "acme.templates.newDoc",
          title: "New From Template",
          menu: "file.new",
          order: 20,
        },
        {
          namespacedId: "acme.notes.createNote",
          title: "New Note",
          menu: "file.new",
          order: 10,
        },
      ],
    );
    expect(menus.some((menu) => menu.id === "extensions")).toBe(false);
    const file = menus.find((menu) => menu.id === "file");
    const submenu = file?.items.find((item) => item.type === "submenu" && item.id === "new");
    expect(submenu && submenu.type === "submenu").toBe(true);
    if (submenu && submenu.type === "submenu") {
      const labels = submenu.items
        .filter((item) => item.type === "command")
        .map((item) => (item.type === "command" ? item.label : ""));
      expect(labels).toEqual(["Untitled", "New Note", "New From Template"]);
    }
  });

  test("unknown capability stays blocked after explicit consent retry", async () => {
    const userData = await tempRoot("blocked");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(
      extensions,
      "test.blocked",
      luaManifest("test.blocked", ["lua", "commands", "ui", "filesystem"]),
    );

    configureExtensionDiscovery(userData);
    const first = await discoverExtensions();
    const blocked = first.installed.find((pack) => pack.id === "test.blocked");
    expect(blocked?.state).toBe("blocked");
    expect(first.loaded).toEqual([]);

    const afterConsent = await loadAllowedBlockedExtension("test.blocked");
    const still = afterConsent.installed.find((pack) => pack.id === "test.blocked");
    // Invalid capability remains blocked after explicit retry.
    expect(still?.state).toBe("blocked");
    expect(afterConsent.loaded).toEqual([]);
  });
});
