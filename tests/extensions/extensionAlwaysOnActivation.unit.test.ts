/**
 * Always-on document activation: preloaded packs expose documentAction and
 * silent invoke applies decorations without a user refresh command.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { cp, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import {
  configureExtensionDiscovery,
  discoverExtensions,
  resetExtensionDiscoveryForTests,
} from "../../src/bun/extensions/discoverExtensions.ts";
import { resetExtensionAllowancesForTests } from "../../src/bun/extensions/extensionAllowances.ts";
import { resetLuaFactoryForTests } from "../../src/bun/extensions/lua/luaEngine.ts";
import {
  configureExtensionHostActions,
  listDocumentActivationCommands,
  resetExtensionRegistryForTests,
  runExtensionCommand,
  setDiscoveredExtensions,
} from "../../src/mainview/extensions/extensionRegistry.ts";
import {
  registerEditorExtensionSeam,
  resetEditorExtensionSeamForTests,
} from "../../src/mainview/extensions/editorExtensionSeam.ts";
import type { ExtensionDecorationRange } from "../../src/mainview/extensions/decorationCapability.ts";

const TODO_PACK = join(
  import.meta.dir,
  "../../../fulvid-extensions/extensions/local.todo-decorator",
);
const MDX_PACK = join(import.meta.dir, "../../../fulvid-extensions/extensions/local.mdx-comments");

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionRegistryForTests();
  resetExtensionAllowancesForTests();
  resetEditorExtensionSeamForTests();
  resetLuaFactoryForTests();
});

async function installOfficial(userData: string): Promise<void> {
  const root = join(userData, "extensions");
  await mkdir(root, { recursive: true });
  await cp(TODO_PACK, join(root, "local.todo-decorator"), { recursive: true });
  await cp(MDX_PACK, join(root, "local.mdx-comments"), { recursive: true });
}

describe("always-on document activation proof", () => {
  test("todo and mdx packs preload with documentAction and decorate via silent invoke", async () => {
    const userData = join(tmpdir(), `fulvid-always-on-${crypto.randomUUID()}`);
    await installOfficial(userData);
    configureExtensionDiscovery(userData);
    const discovery = await discoverExtensions();
    setDiscoveredExtensions(discovery);

    const activations = listDocumentActivationCommands();
    expect(activations.map((a) => a.namespacedId).sort()).toEqual([
      "local.mdx-comments.mdxCommentsRefresh",
      "local.todo-decorator.todoRefresh",
    ]);

    const todoText = [
      "# Task list",
      "",
      "TODO: decorate this marker",
      "FIXME: broken",
      "BUG: boom",
      "HACK: temp",
      "ordinary todolist",
      "",
    ].join("\n");

    let applied: ExtensionDecorationRange[] = [];
    let cleared = false;
    let notified = 0;
    registerEditorExtensionSeam({
      getApplyContext: () => null,
      getDocumentContext: () => ({
        text: todoText,
        documentId: "doc-todo",
        alternativeVersionId: 1,
        cursorLine: 1,
        cursorColumn: 1,
      }),
      replaceSelection: () => false,
      reveal: () => false,
      setExtensionDecorations: (_id, ranges) => {
        applied = [...ranges];
        return true;
      },
      clearExtensionDecorations: () => {
        cleared = true;
        return true;
      },
      hasActiveEditor: () => true,
    });
    configureExtensionHostActions({
      notify: () => {
        notified += 1;
      },
      createUntitled: () => undefined,
      invokeLuaCommand: (request) =>
        import("../../src/bun/extensions/lua/luaExtensionRuntime.ts").then((m) =>
          m.invokeLuaExtensionCommand(request),
        ),
    });

    const handled = await runExtensionCommand("local.todo-decorator.todoRefresh", {
      silent: true,
    });
    expect(handled).toBe(true);
    expect(notified).toBe(0);
    expect(cleared || applied.length > 0).toBe(true);
    expect(applied.length).toBeGreaterThanOrEqual(4);
    const tones = new Set(applied.map((r) => r.appearance?.backgroundColor));
    expect(tones.has("#d29922")).toBe(true);
    expect(tones.has("#ff7b72")).toBe(true);
    expect(applied.every((r) => r.style === undefined && r.appearance)).toBe(true);

    // MDX always-on silent path
    const mdxText = [
      "# MDX",
      "{/* ! critical */}",
      "{/* plain ignored */}",
      "{/* TODO: tagged */}",
      "",
    ].join("\n");
    applied = [];
    notified = 0;
    registerEditorExtensionSeam({
      getApplyContext: () => null,
      getDocumentContext: () => ({
        text: mdxText,
        documentId: "doc-mdx",
        alternativeVersionId: 2,
        cursorLine: 1,
        cursorColumn: 1,
      }),
      replaceSelection: () => false,
      reveal: () => false,
      setExtensionDecorations: (_id, ranges) => {
        applied = [...ranges];
        return true;
      },
      clearExtensionDecorations: () => true,
      hasActiveEditor: () => true,
    });

    const mdxHandled = await runExtensionCommand("local.mdx-comments.mdxCommentsRefresh", {
      silent: true,
    });
    expect(mdxHandled).toBe(true);
    expect(notified).toBe(0);
    expect(applied.length).toBeGreaterThanOrEqual(2);
    expect(applied.every((r) => r.style === undefined && r.appearance)).toBe(true);
    const mdxTones = new Set(applied.map((r) => r.appearance?.backgroundColor));
    expect(mdxTones.has("#ff7b72")).toBe(true);
    expect(mdxTones.has("#d29922")).toBe(true);
  });

  test("silent re-invoke tracks document edits and survives context switch", async () => {
    const userData = join(tmpdir(), `fulvid-always-on-edit-${crypto.randomUUID()}`);
    await installOfficial(userData);
    configureExtensionDiscovery(userData);
    setDiscoveredExtensions(await discoverExtensions());

    let text = "TODO: one\n";
    let version = 1;
    let applied: ExtensionDecorationRange[] = [];
    registerEditorExtensionSeam({
      getApplyContext: () => null,
      getDocumentContext: () => ({
        text,
        documentId: "doc-live",
        alternativeVersionId: version,
        cursorLine: 1,
        cursorColumn: 1,
      }),
      replaceSelection: () => false,
      reveal: () => false,
      setExtensionDecorations: (_id, ranges) => {
        applied = [...ranges];
        return true;
      },
      clearExtensionDecorations: () => {
        applied = [];
        return true;
      },
      hasActiveEditor: () => true,
    });
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: (request) =>
        import("../../src/bun/extensions/lua/luaExtensionRuntime.ts").then((m) =>
          m.invokeLuaExtensionCommand(request),
        ),
    });

    await runExtensionCommand("local.todo-decorator.todoRefresh", { silent: true });
    expect(applied.length).toBe(1);

    text = "TODO: one\nFIXME: two\nBUG: three\n";
    version = 2;
    await runExtensionCommand("local.todo-decorator.todoRefresh", { silent: true });
    expect(applied.length).toBeGreaterThanOrEqual(3);

    text = "plain control document\n";
    version = 3;
    await runExtensionCommand("local.todo-decorator.todoRefresh", { silent: true });
    expect(applied.length).toBe(0);

    text = "TODO: one\nFIXME: two\nBUG: three\n";
    version = 4;
    await runExtensionCommand("local.todo-decorator.todoRefresh", { silent: true });
    expect(applied.length).toBeGreaterThanOrEqual(3);
  });
});
