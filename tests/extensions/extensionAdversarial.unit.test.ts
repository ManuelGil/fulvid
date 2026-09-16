/**
 * High-value adversarial / invariant tests for the extension trust boundary.
 * Prefer fail-closed regressions over coverage padding.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  findLuaCommand,
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaCommandStoreForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import {
  createHardenedLuaEngine,
  luaGlobalType,
  resetLuaFactoryForTests,
} from "../../src/bun/extensions/lua/luaEngine.ts";
import { LUA_EXTENSION_LIMITS } from "../../src/bun/extensions/lua/luaLimits.ts";
import { parseExtensionDecorationRanges } from "../../src/mainview/extensions/decorationCapability.ts";
import { validateExtensionManifest } from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";
import {
  configureExtensionHostActions,
  resetExtensionRegistryForTests,
  runExtensionCommand,
  setDiscoveredExtensions,
  type ExtensionLuaInvokeResult,
} from "../../src/mainview/extensions/extensionRegistry.ts";
import {
  registerEditorExtensionSeam,
  resetEditorExtensionSeamForTests,
} from "../../src/mainview/extensions/editorExtensionSeam.ts";

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-adv-${label}-${crypto.randomUUID()}`);
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

async function loadPack(pack: string) {
  const validated = validateExtensionManifest(
    JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
  );
  if (!("manifest" in validated)) {
    throw new Error(validated.reason);
  }
  return loadLuaExtensionPack(pack, validated.manifest);
}

afterEach(() => {
  resetExtensionRegistryForTests();
  resetEditorExtensionSeamForTests();
  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
});

describe("adversarial lua sandbox", () => {
  test("forbidden globals stay nil and bytecode entry is rejected", async () => {
    const engine = await createHardenedLuaEngine();
    try {
      for (const name of [
        "io",
        "os",
        "package",
        "debug",
        "require",
        "dofile",
        "loadfile",
        "load",
        "loadstring",
      ]) {
        expect(await luaGlobalType(engine, name)).toBe("nil");
      }
      const dumpType = await engine.doString("return type(string.dump)");
      expect(String(dumpType)).toBe("nil");
    } finally {
      engine.global.close();
    }

    const root = await tempRoot("bytecode");
    const pack = await writePack(root, "test.adv-bytecode", luaManifest("test.adv-bytecode"), {
      "entry.lua": "\u001bLua\0fake-bytecode",
    });
    await expect(loadPack(pack)).rejects.toMatchObject({ reason: "bytecode entry is not allowed" });
    expect(findLuaCommand("test.adv-bytecode.ping")).toBeNull();
  });
});

describe("adversarial resource bounds", () => {
  test("rejects oversized titles, notify flood, decoration coords, and reveal", async () => {
    const root = await tempRoot("bounds");
    const title = "T".repeat(LUA_EXTENSION_LIMITS.maxCommandTitleChars.value + 1);
    const titlePack = await writePack(root, "test.adv-title", luaManifest("test.adv-title"), {
      "entry.lua": `
commands.register({
  id = "ping",
  title = ${JSON.stringify(title)},
  run = function() end
})
`,
    });
    await expect(loadPack(titlePack)).rejects.toBeDefined();
    expect(findLuaCommand("test.adv-title.ping")).toBeNull();

    const limit = LUA_EXTENSION_LIMITS.maxNotificationsPerInvoke.value;
    const floodPack = await writePack(root, "test.adv-flood", luaManifest("test.adv-flood"), {
      "entry.lua": `
commands.register({
  id = "flood",
  title = "Flood",
  run = function()
    for i = 1, ${limit + 1} do
      ui.notify("n" .. tostring(i))
    end
  end
})
`,
    });
    await loadPack(floodPack);
    const flood = await invokeLuaExtensionCommand("test.adv-flood.flood");
    expect(flood.ok).toBe(false);
    if (!flood.ok) {
      expect(flood.error).toMatch(/size limit/i);
    }

    const max = LUA_EXTENSION_LIMITS.maxRevealPosition.value;
    expect(
      parseExtensionDecorationRanges([
        {
          startLine: max + 1,
          startColumn: 1,
          endLine: max + 1,
          endColumn: 2,
          style: "info",
        },
      ]),
    ).toEqual({ ok: false, error: "invalid decoration range" });

    const revealPack = await writePack(
      root,
      "test.adv-reveal",
      luaManifest("test.adv-reveal", ["lua", "commands", "ui", "document"]),
      {
        "entry.lua": `
commands.register({
  id = "go",
  title = "Go",
  run = function()
    document.reveal(${LUA_EXTENSION_LIMITS.maxRevealPosition.value + 1}, 1)
  end
})
`,
      },
    );
    await loadPack(revealPack);
    const reveal = await invokeLuaExtensionCommand({
      namespacedId: "test.adv-reveal.go",
      document: {
        text: "hi",
        documentId: "untitled:1",
        alternativeVersionId: 1,
        cursorLine: 1,
        cursorColumn: 1,
      },
    });
    expect(reveal.ok).toBe(false);
  });
});

describe("adversarial lifecycle and isolation", () => {
  test("reentrancy fail-closed, capability denial, and malformed DTO", async () => {
    const root = await tempRoot("lifecycle");

    // Overlapping loads first — cold factory so createHardenedLuaEngine overlaps.
    const a = await writePack(root, "test.adv-loada", luaManifest("test.adv-loada"), {
      "entry.lua": `
commands.register({ id = "a", title = "A", run = function() ui.notify("a") end })
`,
    });
    const b = await writePack(root, "test.adv-loadb", luaManifest("test.adv-loadb"), {
      "entry.lua": `
commands.register({ id = "b", title = "B", run = function() ui.notify("b") end })
`,
    });
    let rejectedLoads = 0;
    for (let attempt = 0; attempt < 5 && rejectedLoads === 0; attempt += 1) {
      resetLuaCommandStoreForTests();
      resetLuaFactoryForTests();
      const loadOutcomes = await Promise.allSettled([loadPack(a), loadPack(b)]);
      rejectedLoads = loadOutcomes.filter((entry) => entry.status === "rejected").length;
    }
    expect(rejectedLoads).toBeGreaterThanOrEqual(1);
    resetLuaCommandStoreForTests();
    resetLuaFactoryForTests();
    await loadPack(a);
    expect(await invokeLuaExtensionCommand("test.adv-loada.a")).toEqual({
      ok: true,
      notifications: ["a"],
    });

    const reentry = await writePack(root, "test.adv-reentry", luaManifest("test.adv-reentry"), {
      "entry.lua": `
commands.register({
  id = "outer",
  title = "Outer",
  run = function()
    ui.notify("done")
  end
})
`,
    });
    await loadPack(reentry);

    const invokeResults = await Promise.all(
      Array.from({ length: 12 }, () => invokeLuaExtensionCommand("test.adv-reentry.outer")),
    );
    expect(invokeResults.some((entry) => entry.ok)).toBe(true);
    expect(invokeResults.some((entry) => !entry.ok && entry.error.includes("reentrancy"))).toBe(
      true,
    );
    expect(findLuaCommand("test.adv-reentry.outer")).not.toBeNull();

    const nocap = await writePack(root, "test.adv-nocap", luaManifest("test.adv-nocap"), {
      "entry.lua": `
commands.register({
  id = "probe",
  title = "Probe",
  run = function()
    if editor ~= nil then error("editor leaked") end
    if document ~= nil then error("document leaked") end
    if decorations ~= nil then error("decorations leaked") end
  end
})
`,
    });
    await loadPack(nocap);
    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.adv-nocap.probe",
        editor: {
          selection: "x",
          documentId: "d",
          alternativeVersionId: 1,
          startOffset: 0,
          endOffset: 1,
        },
      }),
    ).toEqual({ ok: false, error: "editor capability not granted" });

    expect(await invokeLuaExtensionCommand({ namespacedId: "" } as never)).toEqual({
      ok: false,
      error: "invalid invoke request",
    });
    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.missing.x",
        editor: { selection: 1 } as never,
      }),
    ).toEqual({ ok: false, error: "invalid editor snapshot" });
  });
});

describe("adversarial renderer apply boundary", () => {
  test("rejects oversized createUntitled, notify flood DTO, and unknown decoration style", async () => {
    const oversized = "x".repeat(LUA_EXTENSION_LIMITS.maxCreateUntitledChars.value + 1);
    let created = false;
    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.adv-reg",
          publisher: "test",
          name: "Reg",
          displayName: "Reg",
          version: "0.0.0",
          api: 1,
          description: "Test extension",
          capabilities: ["lua", "commands", "ui", "document"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [{ id: "go", namespacedId: "test.adv-reg.go", title: "Go" }],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => {
        created = true;
      },
      invokeLuaCommand: async (): Promise<ExtensionLuaInvokeResult> => ({
        ok: true,
        notifications: [],
        createUntitled: oversized,
      }),
    });
    await expect(runExtensionCommand("test.adv-reg.go")).rejects.toThrow(/too large|size limit/i);
    expect(created).toBe(false);

    const messages = Array.from(
      { length: LUA_EXTENSION_LIMITS.maxNotificationsPerInvoke.value + 1 },
      (_, i) => `n${i}`,
    );
    let notified = 0;
    created = false;
    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.adv-reg2",
          publisher: "test",
          name: "Reg2",
          displayName: "Reg2",
          version: "0.0.0",
          api: 1,
          description: "Test extension",
          capabilities: ["lua", "commands", "ui", "document"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [{ id: "go", namespacedId: "test.adv-reg2.go", title: "Go" }],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    configureExtensionHostActions({
      notify: () => {
        notified += 1;
      },
      createUntitled: () => {
        created = true;
      },
      invokeLuaCommand: async (): Promise<ExtensionLuaInvokeResult> => ({
        ok: true,
        notifications: messages,
        createUntitled: "# ok",
      }),
    });
    await expect(runExtensionCommand("test.adv-reg2.go")).rejects.toThrow(/too large|size limit/i);
    expect(notified).toBe(0);
    expect(created).toBe(false);

    let applied = false;
    registerEditorExtensionSeam({
      getApplyContext: () => null,
      getDocumentContext: () => ({
        text: "hi",
        documentId: "untitled:1",
        alternativeVersionId: 1,
        cursorLine: 1,
        cursorColumn: 1,
      }),
      replaceSelection: () => false,
      reveal: () => false,
      setExtensionDecorations: () => {
        applied = true;
        return true;
      },
      clearExtensionDecorations: () => false,
      hasActiveEditor: () => true,
    });
    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.adv-deco",
          publisher: "test",
          name: "Deco",
          displayName: "Deco",
          version: "0.0.0",
          api: 1,
          description: "Test extension",
          capabilities: ["lua", "commands", "ui", "decorations"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [{ id: "go", namespacedId: "test.adv-deco.go", title: "Go" }],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: async (): Promise<ExtensionLuaInvokeResult> => ({
        ok: true,
        notifications: [],
        decorations: {
          set: [
            {
              startLine: 1,
              startColumn: 1,
              endLine: 1,
              endColumn: 2,
              style: "javascript:alert(1)",
            },
          ],
        },
      }),
    });
    await expect(runExtensionCommand("test.adv-deco.go")).rejects.toBeDefined();
    expect(applied).toBe(false);
  });
});
