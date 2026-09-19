import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import { namespacedExtensionCommandId } from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest, tempExtensionRoot, writeExtensionPack } from "./manifestTestHelpers.ts";
import {
  configureExtensionHostActions,
  listExtensionCommands,
  resetExtensionRegistryForTests,
  runExtensionCommand,
  setDiscoveredExtensions,
} from "../../src/mainview/extensions/extensionRegistry.ts";
import { invokeLuaExtensionCommand } from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";

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
  test("empty root; loads valid packs and isolates id mismatch / malformed neighbors", async () => {
    const emptyRoot = await tempExtensionRoot("empty");
    configureExtensionDiscovery(join(emptyRoot, "userData"));
    const empty = await discoverExtensions();
    expect(empty.loaded).toEqual([]);
    expect(empty.failed).toEqual([]);

    const userData = join(await tempExtensionRoot("iso"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writeExtensionPack(extensions, "test.good", luaManifest("test.good"), {
      "entry.lua": notifyLua,
    });
    await writeExtensionPack(
      extensions,
      "test.bad",
      luaManifest("test.bad", ["filesystem"], { entry: undefined }),
    );
    await writeExtensionPack(extensions, "test.also-good", luaManifest("test.also-good"), {
      "entry.lua": notifyLua.replace('"ok"', '"also"'),
    });
    await writeExtensionPack(
      extensions,
      "test.second",
      luaManifest("test.first", ["lua", "commands", "ui"], { version: "2.0.0" }),
      { "entry.lua": notifyLua },
    );
    await mkdir(join(extensions, "test.missing"), { recursive: true });
    await mkdir(join(extensions, "test.malformed"), { recursive: true });
    await writeFile(join(extensions, "test.malformed", "manifest.json"), "{not-json");
    await writeExtensionPack(extensions, "test.ok", luaManifest("test.ok"), {
      "entry.lua": notifyLua,
    });

    configureExtensionDiscovery(userData);
    const result = await discoverExtensions();
    expect(result.loaded.map((pack) => pack.id).sort()).toEqual([
      "test.also-good",
      "test.good",
      "test.ok",
    ]);
    expect(result.failed.some((failure) => failure.id === "test.bad")).toBe(true);
    expect(result.failed.some((failure) => failure.id === "test.second")).toBe(true);
    expect(result.failed.map((failure) => failure.id).sort()).toEqual(
      expect.arrayContaining(["test.malformed", "test.missing"]),
    );
  });

  test("rejects entry path traversal outside the pack", async () => {
    const userData = join(await tempExtensionRoot("escape"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });
    await writeFile(join(extensions, "secret.lua"), "print(1)\n");
    await writeExtensionPack(extensions, "test.escape", {
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
  // Notify-only host bridge is covered by editor capability tests; this keeps
  // discovery -> runExtensionCommand -> createUntitled as one observable path.
  test("createUntitled queues through the host after discovery", async () => {
    const userData = join(await tempExtensionRoot("bridge"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });

    await writeExtensionPack(
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
    expect(discovered.loaded.map((pack) => pack.id)).toEqual(["test.bridge-untitled"]);
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
      await runExtensionCommand(namespacedExtensionCommandId("test.bridge-untitled", "note")),
    ).toBe(true);
    expect(untitledBodies).toEqual(["# Note\n"]);
    expect(notifications).toEqual(["created"]);
    expect(listExtensionCommands().every((command) => command.namespacedId.includes("."))).toBe(
      true,
    );
  });
});
