import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { tmpdir } from "node:os";

import {
  invokeLuaExtensionCommand,
  loadLuaExtensionPack,
  resetLuaCommandStore,
} from "../../src/bun/extensions/lua/luaExtensionRuntime.ts";
import { resetLuaFactoryForTests } from "../../src/bun/extensions/lua/luaEngine.ts";
import { LUA_EXTENSION_LIMITS } from "../../src/bun/extensions/lua/luaLimits.ts";
import {
  editorReplaceLimitError,
  editorSelectionLimitError,
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

async function loadValidatedPack(pack: string) {
  const validated = validateExtensionManifest(
    JSON.parse(await readFile(join(pack, "manifest.json"), "utf8")),
  );
  if (!("manifest" in validated)) {
    throw new Error(validated.reason);
  }
  await loadLuaExtensionPack(pack, validated.manifest);
}

function registerEditorFixture(): void {
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
        location: join(tmpdir(), "test-extension"),
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
}

afterEach(() => {
  resetEditorExtensionSeamForTests();
  resetExtensionRegistryForTests();
  resetLuaCommandStore();
  resetLuaFactoryForTests();
});

describe("editor capability contract", () => {
  test("pins 256 KiB limits and detects stale snapshot identity", () => {
    const limit = 256 * 1024;
    expect(EDITOR_EXTENSION_LIMITS.maxSelectionChars.value).toBe(limit);
    expect(LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value).toBe(limit);
    expect(editorReplaceLimitError(1)).toBe("editor.replaceSelection requires a string");
    expect(editorSelectionLimitError("x".repeat(limit))).toBeNull();
    expect(editorReplaceLimitError("x".repeat(limit))).toBeNull();
    expect(editorSelectionLimitError("x".repeat(limit + 1))).toBe(
      "editor selection exceeds size limit",
    );
    expect(editorReplaceLimitError("x".repeat(limit + 1))).toBe(
      "editor.replaceSelection exceeds size limit",
    );

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
  test("wraps selection, empty selection notifies, and getSelection is a plain string", async () => {
    const root = await tempRoot("happy");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    await loadValidatedPack(pack);

    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.contract-lua-editor.wrapBold",
        editor: editorSnap("hello"),
      }),
    ).toEqual({
      ok: true,
      notifications: ["wrapped"],
      editor: { replaceSelection: "**hello**" },
    });

    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.contract-lua-editor.wrapBold",
        editor: editorSnap(""),
      }),
    ).toEqual({ ok: true, notifications: ["no selection"] });

    const applied: string[] = [];
    const notifications: string[] = [];
    const snap = editorSnap("world");
    stubSeam({
      getApplyContext: () => snap,
      replaceSelection: (text) => {
        applied.push(text);
        return true;
      },
    });
    registerEditorFixture();
    configureExtensionHostActions({
      notify: (message) => notifications.push(message),
      createUntitled: () => undefined,
      invokeLuaCommand: (request) => invokeLuaExtensionCommand(request),
    });
    expect(await runExtensionCommand("test.contract-lua-editor.wrapBold")).toBe(true);
    expect(applied).toEqual(["**world**"]);
    expect(notifications).toEqual(["wrapped"]);

    const plain = await writePack(
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
    await loadValidatedPack(plain);
    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.contract-lua-plain.probe",
        editor: editorSnap("plain-data"),
      }),
    ).toEqual({ ok: true, notifications: ["plain-data"] });
  });

  test("stale apply, no editor, oversized, and capability denial fail closed", async () => {
    const root = await tempRoot("fail");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    await loadValidatedPack(pack);

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
    registerEditorFixture();
    await expect(runExtensionCommand("test.contract-lua-editor.wrapBold")).rejects.toThrow(
      /document or selection changed/i,
    );

    stubSeam({
      getApplyContext: () => null,
      replaceSelection: () => false,
      hasActiveEditor: () => false,
    });
    registerEditorFixture();
    await expect(runExtensionCommand("test.contract-lua-editor.wrapBold")).rejects.toThrow(
      /Open a document in the editor first/i,
    );

    const oversized = "z".repeat(EDITOR_EXTENSION_LIMITS.maxSelectionChars.value + 1);
    stubSeam({
      getApplyContext: () => editorSnap(oversized),
    });
    registerEditorFixture();
    await expect(runExtensionCommand("test.contract-lua-editor.wrapBold")).rejects.toThrow(
      /too large|size limit/i,
    );

    const big = await writePack(
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
    await loadValidatedPack(big);
    const bigResult = await invokeLuaExtensionCommand({
      namespacedId: "test.contract-lua-bigrep.boom",
      editor: editorSnap("x"),
    });
    expect(bigResult.ok).toBe(false);
    if (!bigResult.ok) {
      expect(bigResult.error).toMatch(/exceeds size limit/);
    }

    // Capability denial covered in adversarial; keep nil-without-cap smoke for editor surface.
    const noed = await writePack(
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
    await loadValidatedPack(noed);
    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.contract-lua-noed.ping",
        editor: editorSnap("secret"),
      }),
    ).toEqual({
      ok: false,
      error: "editor capability not granted",
      failureKind: "commandFailed",
    });
    expect(await invokeLuaExtensionCommand("test.contract-lua-noed.ping")).toEqual({
      ok: true,
      notifications: ["ok"],
    });
  });
});
