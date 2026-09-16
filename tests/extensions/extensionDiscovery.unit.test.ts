import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import { namespacedExtensionCommandId } from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";
import {
  configureExtensionHostActions,
  discoveredExtensions,
  listExtensionCommands,
  resetExtensionRegistryForTests,
  runExtensionCommand,
  setDiscoveredExtensions,
} from "../../src/mainview/extensions/extensionRegistry.ts";
import { invokeLuaExtensionCommand } from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";

async function tempExtensionsRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-ext-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writePack(
  root: string,
  id: string,
  manifest: unknown,
  files: Record<string, string> = {},
): Promise<void> {
  const pack = join(root, id);
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(pack, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
}

const notifyLua = `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    ui.notify("ok")
  end
})
`;

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionRegistryForTests();
});

describe("extension discovery", () => {
  test("returns empty when the extensions directory has no packs", async () => {
    const root = await tempExtensionsRoot("empty");
    configureExtensionDiscovery(join(root, "userData"));
    const result = await discoverExtensions();
    expect(result.loaded).toEqual([]);
    expect(result.failed).toEqual([]);
  });

  test("loads a valid pack and isolates a broken neighbor", async () => {
    const userData = join(await tempExtensionsRoot("iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "test.good", luaManifest("test.good"), { "entry.lua": notifyLua });
    await writePack(
      extensions,
      "test.bad",
      luaManifest("test.bad", ["filesystem"], { entry: undefined }),
    );
    await writePack(extensions, "test.also-good", luaManifest("test.also-good"), {
      "entry.lua": notifyLua.replace('"ok"', '"also"'),
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id).sort()).toEqual(["test.also-good", "test.good"]);
    expect(result.failed.some((failure) => failure.id === "test.bad")).toBe(true);
  });

  test("rejects a manifest id that does not match its directory", async () => {
    const userData = join(await tempExtensionsRoot("dup"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writePack(extensions, "test.first", luaManifest("test.first"), {
      "entry.lua": notifyLua,
    });
    await writePack(
      extensions,
      "test.second",
      luaManifest("test.first", ["lua", "commands", "ui"], { version: "2.0.0" }),
      { "entry.lua": notifyLua },
    );

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id)).toEqual(["test.first"]);
    expect(result.failed.some((failure) => failure.id === "test.second")).toBe(true);
  });

  test("fails closed on missing or malformed manifests without stopping discovery", async () => {
    const userData = join(await tempExtensionsRoot("miss"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(join(extensions, "test.missing"), { recursive: true });
    await mkdir(join(extensions, "test.malformed"), { recursive: true });
    await writeFile(join(extensions, "test.malformed", "manifest.json"), "{not-json");
    await writePack(extensions, "test.ok", luaManifest("test.ok"), { "entry.lua": notifyLua });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id)).toEqual(["test.ok"]);
    expect(result.failed.map((failure) => failure.id).sort()).toEqual([
      "test.malformed",
      "test.missing",
    ]);
  });

  test("rejects entry path traversal outside the pack", async () => {
    const userData = join(await tempExtensionsRoot("escape"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writeFile(join(extensions, "secret.lua"), "print(1)\n");
    await writePack(extensions, "test.escape", {
      ...luaManifest("test.escape", ["lua", "commands", "ui"], { entry: "../secret.lua" }),
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded).toEqual([]);
    const escapeFailure = result.failed.find((failure) => failure.id === "test.escape");
    expect(escapeFailure).toBeDefined();
    expect(escapeFailure?.reason).toMatch(/entry|outside|relative/i);
  });
});

describe("lua host actions", () => {
  test("notify and createUntitled queue through host bridges without shipped packs", async () => {
    const userData = join(await tempExtensionsRoot("bridge"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });

    await writePack(extensions, "test.bridge-notify", luaManifest("test.bridge-notify"), {
      "entry.lua": `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    ui.notify("bridge ok")
  end
})
`,
    });
    await writePack(
      extensions,
      "test.bridge-untitled",
      luaManifest("test.bridge-untitled", ["lua", "commands", "ui", "document"]),
      {
        "entry.lua": `
commands.register({
  id = "note",
  title = "Note",
  run = function()
    document.createUntitled("# Note\\n")
    ui.notify("created")
  end
})
`,
      },
    );

    configureExtensionDiscovery(userData);
    const discovered = await discoverExtensions();
    expect(discovered.loaded.map((pack) => pack.id).sort()).toEqual([
      "test.bridge-notify",
      "test.bridge-untitled",
    ]);
    setDiscoveredExtensions(discovered);

    const notifications: string[] = [];
    const untitledBodies: string[] = [];
    configureExtensionHostActions({
      notify: (message) => notifications.push(message),
      createUntitled: (content) => {
        untitledBodies.push(content);
      },
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    expect(
      await runExtensionCommand(namespacedExtensionCommandId("test.bridge-notify", "ping")),
    ).toBe(true);
    expect(notifications).toEqual(["bridge ok"]);

    expect(
      await runExtensionCommand(namespacedExtensionCommandId("test.bridge-untitled", "note")),
    ).toBe(true);
    expect(untitledBodies).toEqual(["# Note\n"]);
    expect(notifications).toEqual(["bridge ok", "created"]);
    expect(listExtensionCommands().every((command) => command.namespacedId.includes("."))).toBe(
      true,
    );
    expect(discoveredExtensions.value.loaded).toHaveLength(2);
  });
});
