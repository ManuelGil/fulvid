import { afterEach, describe, expect, test } from "bun:test";
import { cp } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  invokeLuaExtensionCommand,
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
  documentTextLimitError,
  DOCUMENT_EXTENSION_LIMITS,
  type DocumentSnapshot,
} from "../../src/mainview/extensions/documentCapability.ts";
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
import {
  loadValidatedLuaPack,
  luaManifest,
  tempExtensionRoot,
  writeExtensionPack,
} from "./manifestTestHelpers.ts";

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

function docSnap(text: string, overrides: Partial<DocumentSnapshot> = {}): DocumentSnapshot {
  return {
    text,
    documentId: "untitled:1",
    alternativeVersionId: 1,
    cursorLine: 1,
    cursorColumn: 1,
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
  test("selection size boundaries and stale snapshot identity", () => {
    const limit = EDITOR_EXTENSION_LIMITS.maxSelectionChars.value;
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
    const root = await tempExtensionRoot("happy");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    await loadValidatedLuaPack(pack);

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

    const plain = await writeExtensionPack(
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
    await loadValidatedLuaPack(plain);
    expect(
      await invokeLuaExtensionCommand({
        namespacedId: "test.contract-lua-plain.probe",
        editor: editorSnap("plain-data"),
      }),
    ).toEqual({ ok: true, notifications: ["plain-data"] });
  });

  test("stale apply, no editor, oversized, and capability denial fail closed", async () => {
    const root = await tempExtensionRoot("fail");
    const pack = join(root, "test.contract-lua-editor");
    await cp(EDITOR_FIXTURE, pack, { recursive: true });
    await loadValidatedLuaPack(pack);

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

    const big = await writeExtensionPack(
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
    await loadValidatedLuaPack(big);
    const bigResult = await invokeLuaExtensionCommand({
      namespacedId: "test.contract-lua-bigrep.boom",
      editor: editorSnap("x"),
    });
    expect(bigResult.ok).toBe(false);
    if (!bigResult.ok) {
      expect(bigResult.error).toMatch(/exceeds size limit/);
    }

    // Capability denial covered in adversarial; keep nil-without-cap smoke for editor surface.
    const noed = await writeExtensionPack(
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
    await loadValidatedLuaPack(noed);
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

describe("host document/decorations contracts", () => {
  test("document size boundary and Lua document/decoration happy path", async () => {
    const limit = DOCUMENT_EXTENSION_LIMITS.maxTextChars.value;
    expect(documentTextLimitError("x".repeat(limit))).toBeNull();
    expect(documentTextLimitError("x".repeat(limit + 1))).toBe("document text exceeds size limit");

    const root = await tempExtensionRoot("host");
    const pack = await writeExtensionPack(
      root,
      "test.contract-host",
      luaManifest("test.contract-host", ["lua", "commands", "ui", "document", "decorations"], {
        version: "0.0.0",
        displayName: "Host",
      }),
      {
        "entry.lua": `
commands.register({
  id = "run",
  title = "Run",
  run = function()
    local text = document.getText()
    local cursor = document.getCursor()
    decorations.set({
      { startLine = 1, startColumn = 1, endLine = 1, endColumn = 2, style = "info" },
    })
    document.reveal(cursor.line, cursor.column)
    document.createUntitled("# " .. text)
    ui.notify("ok")
  end
})
`,
      },
    );
    await loadValidatedLuaPack(pack);
    const result = await invokeLuaExtensionCommand({
      namespacedId: "test.contract-host.run",
      document: docSnap("body", { cursorLine: 2, cursorColumn: 3 }),
    });
    expect(result).toEqual({
      ok: true,
      notifications: ["ok"],
      createUntitled: "# body",
      reveal: { lineNumber: 2, column: 3 },
      decorations: {
        set: [{ startLine: 1, startColumn: 1, endLine: 1, endColumn: 2, style: "info" }],
      },
    });
  });
});
