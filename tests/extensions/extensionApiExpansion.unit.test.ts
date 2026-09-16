import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, writeFile } from "node:fs/promises";
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
  assertDocumentTextWithinLimit,
  DOCUMENT_EXTENSION_LIMITS,
  type DocumentSnapshot,
} from "../../src/mainview/extensions/documentCapability.ts";
import {
  parseExtensionDecorationRanges,
  DECORATION_EXTENSION_LIMITS,
} from "../../src/mainview/extensions/decorationCapability.ts";
import { resetEditorExtensionSeamForTests } from "../../src/mainview/extensions/editorExtensionSeam.ts";
import { resetExtensionRegistryForTests } from "../../src/mainview/extensions/extensionRegistry.ts";
import {
  ALLOWED_EXTENSION_CAPABILITIES,
  validateExtensionManifest,
} from "../../src/mainview/extensions/extensionManifest.ts";
import { luaManifest } from "./manifestTestHelpers.ts";

async function tempRoot(label: string): Promise<string> {
  const root = join(tmpdir(), `fulvid-ext-api-${label}-${crypto.randomUUID()}`);
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

afterEach(() => {
  resetEditorExtensionSeamForTests();
  resetExtensionRegistryForTests();
  resetLuaCommandStoreForTests();
  resetLuaFactoryForTests();
});

describe("host document/decorations contracts", () => {
  test("pins budgets, closed styles, and Lua document/decoration happy path", async () => {
    expect(ALLOWED_EXTENSION_CAPABILITIES).toContain("document");
    expect(ALLOWED_EXTENSION_CAPABILITIES).toContain("decorations");
    const limit = DOCUMENT_EXTENSION_LIMITS.maxTextChars.value;
    expect(limit).toBe(512 * 1024);
    expect(LUA_EXTENSION_LIMITS.maxDocumentTextChars.value).toBe(limit);
    expect(assertDocumentTextWithinLimit("x".repeat(limit))).toBeNull();
    expect(assertDocumentTextWithinLimit("x".repeat(limit + 1))).toBe(
      "document text exceeds size limit",
    );

    expect(DECORATION_EXTENSION_LIMITS.maxRanges.value).toBe(500);
    expect(
      parseExtensionDecorationRanges([
        { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4, style: "warn" },
      ]),
    ).toMatchObject({ ok: true });
    expect(
      parseExtensionDecorationRanges([
        { startLine: 1, startColumn: 1, endLine: 1, endColumn: 4, style: "note" },
      ]),
    ).toEqual({ ok: false, error: "unknown decoration style: note" });

    const root = await tempRoot("host");
    const pack = await writePack(
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
    const validated = validateExtensionManifest(
      JSON.parse(await Bun.file(join(pack, "manifest.json")).text()),
    );
    if (!("manifest" in validated)) {
      throw new Error(validated.reason);
    }
    await loadLuaExtensionPack(pack, validated.manifest);
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
