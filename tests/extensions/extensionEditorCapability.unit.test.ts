import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaCommandStoreForTests,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import { resetLuaFactoryForTests } from "../../src/bun/extensions/lua/luaEngine.ts";
import { LUA_EXTENSION_LIMITS } from "../../src/bun/extensions/lua/luaLimits.ts";
import {
  assertEditorReplaceWithinLimit,
  assertEditorSelectionWithinLimit,
  editorSnapshotIsCurrent,
  EDITOR_EXTENSION_LIMITS,
  type EditorSelectionSnapshot,
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
import { luaManifest } from "./manifestTestHelpers.ts";

const EDITOR_FIXTURE = join(import.meta.dir, "fixtures/test.contract-lua-editor");

function editorSnap(
  selection: string,
  overrides: Partial<EditorSelectionSnapshot> = {},
): EditorSelectionSnapshot {
  return {
    selection,
    documentId: "untitled:1",
    alternativeVersionId: 1,
    startOffset: 0,
    endOffset: selection.length,
    ...overrides,
  };
}

/** Minimal seam stubs for editor-only tests (new document/decoration APIs unused). */
function stubSeam(
  partial: Partial<Parameters<typeof registerEditorExtensionSeam>[0]> & {
    getApplyContext: () => EditorSelectionSnapshot | null;
    replaceSelection?: (text: string) => boolean;
    hasActiveEditor?: () => boolean;
  },
): void {
  registerEditorExtensionSeam({
    getApplyContext: partial.getApplyContext,
    getDocumentContext: partial.getDocumentContext ?? (() => null),
    replaceSelection: partial.replaceSelection ?? (() => true),
    reveal: partial.reveal ?? (() => false),
    setExtensionDecorations: partial.setExtensionDecorations ?? (() => false),
    clearExtensionDecorations: partial.clearExtensionDecorations ?? (() => false),
    hasActiveEditor: partial.hasActiveEditor ?? (() => true),
  });
}

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
  test("pins selection and replace boundary at 256 KiB", () => {
    const limit = 256 * 1024;
    expect(EDITOR_EXTENSION_LIMITS.maxSelectionChars.value).toBe(limit);
    expect(LUA_EXTENSION_LIMITS.maxEditorSelectionChars.status).toBe("implemented");
    expect(assertEditorReplaceWithinLimit(1)).toBe("editor.replaceSelection requires a string");
    expect(assertEditorSelectionWithinLimit("x".repeat(limit))).toBeNull();
    expect(assertEditorReplaceWithinLimit("x".repeat(limit))).toBeNull();
    expect(assertEditorSelectionWithinLimit("x".repeat(limit + 1))).toBe(
      "editor selection exceeds size limit",
    );
    expect(assertEditorReplaceWithinLimit("x".repeat(limit + 1))).toBe(
      "editor.replaceSelection exceeds size limit",
    );
  });

  test("detects stale snapshot identity", () => {
    const snap = editorSnap("hello");
    expect(editorSnapshotIsCurrent(snap, snap)).toBe(true);
    expect(editorSnapshotIsCurrent(snap, editorSnap("hello", { alternativeVersionId: 2 }))).toBe(
      false,
    );
    expect(editorSnapshotIsCurrent(snap, editorSnap("hello", { documentId: "file:/x" }))).toBe(
      false,
    );
    expect(editorSnapshotIsCurrent(snap, editorSnap("hello", { startOffset: 1 }))).toBe(false);
    expect(editorSnapshotIsCurrent(snap, null)).toBe(false);
  });
});

describe("editor snapshot/apply through Lua", () => {
  test("wraps selection via replaceSelection and notifies", async () => {
    const root = await tempRoot("wrap");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    const result = await invokeLuaExtensionCommand({
      namespacedId: "test.contract-lua-editor.wrapBold",
      editor: editorSnap("hello"),
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
      "test.contract-lua-noed",
      luaManifest("test.contract-lua-noed", ["lua", "commands", "ui"], {
        version: "0.0.0",
        displayName: "NoEd",
      }),
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
      namespacedId: "test.contract-lua-noed.ping",
      editor: editorSnap("secret"),
    });
    expect(result).toEqual({ ok: false, error: "editor capability not granted" });

    const allowed = await invokeLuaExtensionCommand("test.contract-lua-noed.ping");
    expect(allowed).toEqual({ ok: true, notifications: ["ok"] });
  });

  test("rejects oversized replaceSelection from Lua", async () => {
    const root = await tempRoot("big-replace");
    const pack = await writePack(
      root,
      "test.contract-lua-bigrep",
      luaManifest("test.contract-lua-bigrep", ["lua", "commands", "ui", "editor"], {
        version: "0.0.0",
        displayName: "Big",
      }),
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
      namespacedId: "test.contract-lua-bigrep.boom",
      editor: editorSnap("x"),
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/exceeds size limit/);
    }
  });

  test("registry applies replace through the Monaco seam owner", async () => {
    const root = await tempRoot("seam");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    const applied: string[] = [];
    const snap = editorSnap("world");
    stubSeam({
      getApplyContext: () => snap,
      replaceSelection: (text) => {
        applied.push(text);
        return true;
      },
    });

    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.contract-lua-editor",
          publisher: "test",
          name: "Editor",
          displayName: "Editor",
          version: "0.0.0",
          api: 1,
          description: "Test editor extension",
          capabilities: ["lua", "commands", "ui", "editor"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [
            {
              id: "wrapBold",
              namespacedId: "test.contract-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
            },
          ],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });

    const notifications: string[] = [];
    configureExtensionHostActions({
      notify: (message) => notifications.push(message),
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    expect(await runExtensionCommand("test.contract-lua-editor.wrapBold")).toBe(true);
    expect(applied).toEqual(["**world**"]);
    expect(notifications).toEqual(["wrapped"]);
  });

  test("rejects stale editor apply when document or selection stamps change", async () => {
    const root = await tempRoot("stale");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    let calls = 0;
    stubSeam({
      getApplyContext: () => {
        calls += 1;
        if (calls === 1) {
          return editorSnap("world", { alternativeVersionId: 1 });
        }
        return editorSnap("world", { alternativeVersionId: 2 });
      },
    });

    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.contract-lua-editor",
          publisher: "test",
          name: "Editor",
          displayName: "Editor",
          version: "0.0.0",
          api: 1,
          description: "Test editor extension",
          capabilities: ["lua", "commands", "ui", "editor"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [
            {
              id: "wrapBold",
              namespacedId: "test.contract-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
            },
          ],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    await expect(runExtensionCommand("test.contract-lua-editor.wrapBold")).rejects.toThrow(
      /document or selection changed/i,
    );
  });

  test("replace without active editor fails closed", async () => {
    const root = await tempRoot("no-monaco");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    stubSeam({
      getApplyContext: () => null,
      replaceSelection: () => false,
      hasActiveEditor: () => false,
    });
    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.contract-lua-editor",
          publisher: "test",
          name: "Editor",
          displayName: "Editor",
          version: "0.0.0",
          api: 1,
          description: "Test editor extension",
          capabilities: ["lua", "commands", "ui", "editor"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [
            {
              id: "wrapBold",
              namespacedId: "test.contract-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
            },
          ],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    await expect(runExtensionCommand("test.contract-lua-editor.wrapBold")).rejects.toThrow(
      /Open a document in the editor first/i,
    );
  });

  test("empty selection notifies without mutating", async () => {
    const root = await tempRoot("empty");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);
    const result = await invokeLuaExtensionCommand({
      namespacedId: "test.contract-lua-editor.wrapBold",
      editor: editorSnap(""),
    });
    expect(result).toEqual({ ok: true, notifications: ["no selection"] });
  });

  test("getSelection returns a plain string with no Monaco/host surface", async () => {
    const root = await tempRoot("plain");
    const pack = await writePack(
      root,
      "test.contract-lua-plain",
      luaManifest("test.contract-lua-plain", ["lua", "commands", "ui", "editor"], {
        version: "0.0.0",
        displayName: "Plain",
      }),
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
      namespacedId: "test.contract-lua-plain.probe",
      editor: editorSnap("plain-data"),
    });
    expect(result).toEqual({ ok: true, notifications: ["plain-data"] });
  });

  test("registry rejects oversized selection snapshots before invoke", async () => {
    const root = await tempRoot("big-sel");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    const validated = validateExtensionManifest(
      JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);

    const oversized = "z".repeat(EDITOR_EXTENSION_LIMITS.maxSelectionChars.value + 1);
    stubSeam({
      getApplyContext: () => editorSnap(oversized),
    });
    setDiscoveredExtensions({
      loaded: [
        {
          id: "test.contract-lua-editor",
          publisher: "test",
          name: "Editor",
          displayName: "Editor",
          version: "0.0.0",
          api: 1,
          description: "Test editor extension",
          capabilities: ["lua", "commands", "ui", "editor"],
          location: "/tmp/test-extension",
          state: "loaded" as const,
          activation: "command" as const,
          commands: [
            {
              id: "wrapBold",
              namespacedId: "test.contract-lua-editor.wrapBold",
              title: "Lua Wrap Bold",
            },
          ],
        },
      ],
      failed: [],
      installed: [],
      extensionsRoot: null,
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });

    await expect(runExtensionCommand("test.contract-lua-editor.wrapBold")).rejects.toThrow(
      /size limit/i,
    );
  });
});
