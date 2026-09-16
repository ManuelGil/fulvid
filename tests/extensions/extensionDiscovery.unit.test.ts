import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import {
  validateExtensionManifest,
  namespacedExtensionCommandId,
} from "../../src/mainview/extensions/extensionManifest.ts";
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

const REPO_FIXTURES = join(import.meta.dir, "../../extensions");

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

describe("extension manifest contract", () => {
  test("accepts a valid api 1 lua manifest", () => {
    const result = validateExtensionManifest(luaManifest("fulvid.host-notify"));
    expect("manifest" in result).toBe(true);
    if ("manifest" in result) {
      expect(result.manifest.id).toBe("fulvid.host-notify");
      expect(result.manifest.publisher).toBe("fulvid");
      expect(result.manifest.name).toBe("host-notify");
    }
  });

  test("rejects an unsupported api version", () => {
    const result = validateExtensionManifest({
      ...luaManifest("fulvid.host-notify"),
      api: 2,
    });
    expect(result).toEqual({ reason: "unsupported api version: 2" });
  });

  test("rejects an unknown capability", () => {
    const result = validateExtensionManifest({
      ...luaManifest("fulvid.host-notify"),
      capabilities: ["monaco"],
    });
    expect(result).toEqual({ reason: "unknown capability: monaco" });
  });

  test("rejects an invalid extension id", () => {
    const result = validateExtensionManifest({
      ...luaManifest("test.bad"),
      id: "test.other",
    });
    expect(result).toEqual({ reason: "id must equal publisher.name" });
  });

  test("rejects commands capability without lua", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("fulvid.host-notify"),
        capabilities: ["commands", "ui"],
        entry: undefined,
      }),
    ).toEqual({ reason: "commands capability requires the lua capability" });
  });

  test("rejects declarative commands and templates keys", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("fulvid.host-notify"),
        commands: [{ id: "ping", title: "Ping", action: "notify", message: "hi" }],
      }),
    ).toEqual({ reason: "forbidden manifest key: commands" });

    expect(
      validateExtensionManifest({
        ...luaManifest("fulvid.blank-note", ["lua", "commands", "ui", "document"]),
        templates: [{ id: "t", name: "T", file: "t.md" }],
      }),
    ).toEqual({ reason: "forbidden manifest key: templates" });
  });

  test("accepts templates capability with lua; rejects without lua", () => {
    expect(
      validateExtensionManifest({
        ...luaManifest("imgildev.adr-templates", [
          "lua",
          "commands",
          "ui",
          "document",
          "templates",
        ]),
      }),
    ).toMatchObject({
      manifest: expect.objectContaining({
        capabilities: expect.arrayContaining(["templates"]),
      }),
    });
    expect(
      validateExtensionManifest({
        ...luaManifest("fulvid.blank-note", ["templates", "commands"], { entry: undefined }),
      }),
    ).toEqual({ reason: "templates capability requires the lua capability" });
  });
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
  test("host-notify and blank-note examples register through Lua bridges", async () => {
    const userData = join(await tempExtensionsRoot("fix"), "userData");
    const extensions = join(userData, "extensions");
    await mkdir(extensions, { recursive: true });

    for (const id of ["fulvid.host-notify", "fulvid.blank-note"] as const) {
      const sourceManifest = await Bun.file(join(REPO_FIXTURES, id, "manifest.json")).text();
      await mkdir(join(extensions, id), { recursive: true });
      await writeFile(join(extensions, id, "manifest.json"), sourceManifest);
      await writeFile(
        join(extensions, id, "entry.lua"),
        await Bun.file(join(REPO_FIXTURES, id, "entry.lua")).text(),
      );
    }

    configureExtensionDiscovery(userData);
    const discovered = await discoverExtensions();
    expect(discovered.loaded.map((pack) => pack.id).sort()).toEqual([
      "fulvid.blank-note",
      "fulvid.host-notify",
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
      await runExtensionCommand(namespacedExtensionCommandId("fulvid.host-notify", "sayReady")),
    ).toBe(true);
    expect(notifications[0]).toMatch(/Extensions are available|host notify/i);

    expect(
      await runExtensionCommand(
        namespacedExtensionCommandId("fulvid.blank-note", "createBlankNote"),
      ),
    ).toBe(true);
    expect(untitledBodies).toHaveLength(1);
    expect(untitledBodies[0]).toContain("Date:");
    expect(untitledBodies[0]).toContain("YYYY-MM-DD");
    expect(notifications.some((message) => /blank note/i.test(message))).toBe(true);
    expect(listExtensionCommands().every((command) => command.namespacedId.includes("."))).toBe(
      true,
    );
    expect(discoveredExtensions.value.loaded).toHaveLength(2);
  });
});
