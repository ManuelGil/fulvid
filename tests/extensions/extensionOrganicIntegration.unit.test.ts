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
import {
  validateExtensionManifest,
  type DiscoveredExtensionCommand,
} from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";
import { integrateExtensionActionsIntoMenus } from "../../src/mainview/shell/applicationMenu/applicationMenuModel.ts";
import {
  listDocumentActivationCommands,
  listExtensionMenuCommands,
  resetExtensionRegistryForTests,
  setDiscoveredExtensions,
} from "../../src/mainview/extensions/extensionRegistry.ts";

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

describe("manifest menu placement and activation", () => {
  test("accepts closed menu targets and document activation", () => {
    const result = validateExtensionManifest({
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
    expect("manifest" in result).toBe(true);
    if ("manifest" in result) {
      expect(result.manifest.activation).toBe("document");
      expect(result.manifest.documentAction).toBe("todoRefresh");
    }
  });

  test("rejects invalid menu targets fail closed", () => {
    const result = validateExtensionManifest({
      ...luaManifest("test.bad-menu"),
      actions: [{ id: "ping", menu: "extensions" }],
    });
    expect(result).toEqual({ reason: "invalid menu target: extensions" });
  });

  test("rejects document activation without documentAction", () => {
    const result = validateExtensionManifest({
      ...luaManifest("test.bad-doc", ["lua", "commands", "ui", "document", "decorations"]),
      activation: "document",
    });
    expect(result).toEqual({ reason: "document activation requires documentAction" });
  });
});

describe("organic menu integration", () => {
  test("places actions under File -> New and never invents Extensions menu", () => {
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
});

describe("preload quarantine and consent", () => {
  test("blocked preflight packs are not executable until consent retries discovery", async () => {
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

  test("document activation commands are listed for always-on host refresh", () => {
    setDiscoveredExtensions({
      loaded: [
        {
          id: "imgildev.todo-decorator",
          publisher: "imgildev",
          name: "TODO",
          displayName: "TODO",
          version: "1.0.0",
          api: 1,
          description: "Test TODO decorator",
          capabilities: ["lua", "commands", "ui", "document", "decorations"],
          commands: [
            {
              id: "todoRefresh",
              namespacedId: "imgildev.todo-decorator.todoRefresh",
              title: "Refresh",
              documentAction: true,
            },
            {
              id: "todoNext",
              namespacedId: "imgildev.todo-decorator.todoNext",
              title: "Next TODO",
              menu: "navigate",
            },
          ] satisfies DiscoveredExtensionCommand[],
          location: "/tmp/imgildev.todo-decorator",
          state: "loaded",
          activation: "document",
          documentAction: "todoRefresh",
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    expect(listDocumentActivationCommands()).toEqual([
      {
        extensionId: "imgildev.todo-decorator",
        namespacedId: "imgildev.todo-decorator.todoRefresh",
      },
    ]);
    expect(listExtensionMenuCommands().map((command) => command.namespacedId)).toEqual([
      "imgildev.todo-decorator.todoNext",
    ]);
  });
});
