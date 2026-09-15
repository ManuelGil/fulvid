import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaFactoryForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import { resetLuaCommandStoreForTests } from "../../src/bun/extensions/lua/luaCommandStore.ts";
import { LUA_EXTENSION_LIMITS } from "../../src/bun/extensions/lua/luaLimits.ts";
import {
  assertEditorReplaceWithinLimit,
  assertEditorSelectionWithinLimit,
  EDITOR_EXTENSION_LIMITS,
} from "../../src/mainview/extensions/editorCapability.ts";
import {
  registerEditorExtensionSeam,
  resetEditorExtensionSeamForTests,
} from "../../src/mainview/extensions/editorExtensionSeam.ts";
import {
  configureExtensionHostActions,
  resetExtensionRegistryForTests,
  runExtensionCommand,
  setDiscoveredExtensions,
} from "../../src/mainview/extensions/extensionRegistry.ts";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";

const EDITOR_FIXTURE = join(import.meta.dir, "fixtures/spike-lua-editor");

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-editor-${label}-${crypto.randomUUID()}`);
  await mkdir(root, { recursive: true });
  return root;
}

async function writePack(
  root: string,
  id: string,
  manifest: unknown,
  files: Record<string, string>,
): Promise<string> {
  const pack = join(root, id);
  await mkdir(pack, { recursive: true });
  await writeFile(join(pack, "manifest.json"), JSON.stringify(manifest, null, 2));
  for (const [relative, content] of Object.entries(files)) {
    const target = join(pack, relative);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, content);
  }
  return pack;
}

afterEach(() => {
  resetEditorExtensionSeamForTests();
  resetExtensionRegistryForTests();
  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
});

describe("editor capability contract", () => {
  test("accepts editor only with lua", () => {
    expect(
      validateExtensionManifest({
        id: "local.spike-lua-editor",
        name: "Editor",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui", "editor"],
        entry: "entry.lua",
      }),
    ).toMatchObject({ manifest: expect.anything() });

    expect(
      validateExtensionManifest({
        id: "local.no-lua-editor",
        name: "Bad",
        version: "0.0.0",
        api: 0,
        capabilities: ["editor", "commands"],
      }),
    ).toEqual({ reason: "editor capability requires the lua capability" });
  });

  test("enforces selection and replace size limits", () => {
    const oversized = "x".repeat(EDITOR_EXTENSION_LIMITS.maxSelectionChars.value + 1);
    expect(assertEditorSelectionWithinLimit(oversized)).toBe("editor selection exceeds size limit");
    expect(assertEditorReplaceWithinLimit(oversized)).toBe(
      "editor.replaceSelection exceeds size limit",
    );
    expect(assertEditorReplaceWithinLimit(1)).toBe("editor.replaceSelection requires a string");
    expect(LUA_EXTENSION_LIMITS.maxEditorSelectionChars.status).toBe("implemented");
  });
});

describe("editor snapshot/apply through Lua", () => {
  test("wraps selection via replaceSelection and notifies", async () => {
    const root = await tempRoot("wrap");
    const pack = join(root, "local.spike-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    const result = await invokeLuaExtensionCommand({
      namespacedId: "local.spike-lua-editor.wrapBold",
      editor: { selection: "hello" },
    });
    expect(result).toEqual({
      ok: true,
      notifications: ["wrapped"],
      editor: { replaceSelection: "**hello**" },
    });
  });

  test("editor global is nil without editor capability", async () => {
    const root = await tempRoot("no-editor");
    const pack = await writePack(
      root,
      "local.spike-lua-noed",
      {
        id: "local.spike-lua-noed",
        name: "NoEd",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui"],
        entry: "entry.lua",
      },
      {
        "entry.lua": `
commands.register({
  id = "ping",
  title = "Ping",
  run = function()
    if editor ~= nil then error("editor leaked") end
    ui.notify("ok")
  end
})
`,
      },
    );
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand({
      namespacedId: "local.spike-lua-noed.ping",
      editor: { selection: "secret" },
    });
    expect(result).toEqual({ ok: false, error: "editor capability not granted" });

    const allowed = await invokeLuaExtensionCommand("local.spike-lua-noed.ping");
    expect(allowed).toEqual({ ok: true, notifications: ["ok"] });
  });

  test("rejects oversized replaceSelection from Lua", async () => {
    const root = await tempRoot("big-replace");
    const pack = await writePack(
      root,
      "local.spike-lua-bigrep",
      {
        id: "local.spike-lua-bigrep",
        name: "Big",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui", "editor"],
        entry: "entry.lua",
      },
      {
        "entry.lua": `
commands.register({
  id = "boom",
  title = "Boom",
  run = function()
    editor.replaceSelection(string.rep("y", ${LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value + 1}))
  end
})
`,
      },
    );
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand({
      namespacedId: "local.spike-lua-bigrep.boom",
      editor: { selection: "x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds size limit/);
    }
  });

  test("registry applies replace through the Monaco seam owner", async () => {
    const root = await tempRoot("seam");
    const pack = join(root, "local.spike-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    const applied: string[] = [];
    registerEditorExtensionSeam({
      getSelection: () => "world",
      replaceSelection: (text) => {
        applied.push(text);
        return true;
      },
      hasActiveEditor: () => true,
    });

    setDiscoveredExtensions({
      loaded: [
        {
          id: "local.spike-lua-editor",
          name: "Editor",
          version: "0.0.0",
          api: 0,
          capabilities: ["lua", "commands", "ui", "editor"],
          commands: [
            {
              id: "wrapBold",
              namespacedId: "local.spike-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
              action: "lua",
            },
          ],
          templates: [],
        },
      ],
      failed: [],
    });

    const notifications: string[] = [];
    configureExtensionHostActions({
      notify: (message) => notifications.push(message),
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    expect(await runExtensionCommand("local.spike-lua-editor.wrapBold")).toBe(true);
    expect(applied).toEqual(["**world**"]);
    expect(notifications).toEqual(["wrapped"]);
  });

  test("replace without active editor fails closed", async () => {
    const root = await tempRoot("no-monaco");
    const pack = join(root, "local.spike-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    registerEditorExtensionSeam({
      getSelection: () => "x",
      replaceSelection: () => false,
      hasActiveEditor: () => false,
    });
    setDiscoveredExtensions({
      loaded: [
        {
          id: "local.spike-lua-editor",
          name: "Editor",
          version: "0.0.0",
          api: 0,
          capabilities: ["lua", "commands", "ui", "editor"],
          commands: [
            {
              id: "wrapBold",
              namespacedId: "local.spike-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
              action: "lua",
            },
          ],
          templates: [],
        },
      ],
      failed: [],
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    await expect(runExtensionCommand("local.spike-lua-editor.wrapBold")).rejects.toThrow(
      /no active editor/,
    );
  });

  test("empty selection notifies without mutating", async () => {
    const root = await tempRoot("empty");
    const pack = join(root, "local.spike-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand({
      namespacedId: "local.spike-lua-editor.wrapBold",
      editor: { selection: "" },
    });
    expect(result).toEqual({ ok: true, notifications: ["no selection"] });
  });

  test("getSelection returns a plain string with no Monaco/host surface", async () => {
    const root = await tempRoot("plain");
    const pack = await writePack(
      root,
      "local.spike-lua-plain",
      {
        id: "local.spike-lua-plain",
        name: "Plain",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui", "editor"],
        entry: "entry.lua",
      },
      {
        "entry.lua": `
commands.register({
  id = "probe",
  title = "Probe",
  run = function()
    local selection = editor.getSelection()
    if type(selection) ~= "string" then error("selection must be string") end
    if editor.get ~= nil then error("editor.get leaked") end
    if editor.open ~= nil then error("editor.open leaked") end
    if editor.activate ~= nil then error("editor.activate leaked") end
    if editor.model ~= nil then error("editor.model leaked") end
    if editor.monaco ~= nil then error("editor.monaco leaked") end
    if host ~= nil then error("host leaked") end
    if type(host) == "table" and host.call then error("host.call leaked") end
    ui.notify(selection)
  end
})
`,
      },
    );
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand({
      namespacedId: "local.spike-lua-plain.probe",
      editor: { selection: "plain-data" },
    });
    expect(result).toEqual({ ok: true, notifications: ["plain-data"] });
  });

  test("registry rejects oversized selection snapshots before invoke", async () => {
    const root = await tempRoot("big-sel");
    const pack = join(root, "local.spike-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    const oversized = "z".repeat(EDITOR_EXTENSION_LIMITS.maxSelectionChars.value + 1);
    registerEditorExtensionSeam({
      getSelection: () => oversized,
      replaceSelection: () => true,
      hasActiveEditor: () => true,
    });
    setDiscoveredExtensions({
      loaded: [
        {
          id: "local.spike-lua-editor",
          name: "Editor",
          version: "0.0.0",
          api: 0,
          capabilities: ["lua", "commands", "ui", "editor"],
          commands: [
            {
              id: "wrapBold",
              namespacedId: "local.spike-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
              action: "lua",
            },
          ],
          templates: [],
        },
      ],
      failed: [],
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    await expect(runExtensionCommand("local.spike-lua-editor.wrapBold")).rejects.toThrow(
      /selection exceeds size limit/,
    );
  });

  test("failed editor pack does not block a later valid editor pack", async () => {
    const root = await tempRoot("iso");
    const bad = await writePack(
      root,
      "local.spike-lua-baded",
      {
        id: "local.spike-lua-baded",
        name: "Bad",
        version: "0.0.0",
        api: 0,
        capabilities: ["lua", "commands", "ui", "editor"],
        entry: "entry.lua",
      },
      {
        "entry.lua": `
commands.register({
  id = "boom",
  title = "Boom",
  run = function()
    error("editor boom")
  end
})
`,
      },
    );
    const good = join(root, "local.spike-lua-editor");
    await cp(EDITOR_FIXTURE, good, { recursive: true });

    const badManifest = validateExtensionManifest(
      JSON.parse(await readFile(join(bad, "manifest.json"), "utf8")),
    );
    const goodManifest = validateExtensionManifest(
      JSON.parse(await readFile(join(good, "manifest.json"), "utf8")),
    );
    if (!("manifest" in badManifest) || !("manifest" in goodManifest)) {
      throw new Error("expected manifests");
    }
    await loadLuaExtensionPack(bad, badManifest.manifest);
    await loadLuaExtensionPack(good, goodManifest.manifest);

    const failed = await invokeLuaExtensionCommand({
      namespacedId: "local.spike-lua-baded.boom",
      editor: { selection: "x" },
    });
    expect(failed.ok).toBe(false);
    if (!failed.ok) {
      expect(failed.error).toContain("editor boom");
    }

    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "local.spike-lua-editor.wrapBold",
        editor: { selection: "ok" },
      }),
    ).toEqual({
      ok: true,
      notifications: ["wrapped"],
      editor: { replaceSelection: "**ok**" },
    });
  });
});
