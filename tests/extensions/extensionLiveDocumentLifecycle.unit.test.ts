/**
 * Live Monaco document contract for document-oriented extensions:
 * snapshots come from the seam (live text + stamps), not the filesystem.
 * Both TODO Decorator and MDX Comments must remain correct across mutations.
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
import { documentSnapshotIsCurrent } from "../../src/mainview/extensions/documentCapability.ts";
import type { ExtensionDecorationRange } from "../../src/mainview/extensions/decorationCapability.ts";
import { LocalizedError } from "../../src/mainview/modules/workspace/filesystem/workspaceErrors.ts";

const TODO_PACK = join(
  import.meta.dir,
  "../../../fulvid-extensions/extensions/imgildev.todo-decorator",
);
const MDX_PACK = join(
  import.meta.dir,
  "../../../fulvid-extensions/extensions/imgildev.mdx-comments",
);

const TODO_REFRESH = "imgildev.todo-decorator.todoRefresh";
const MDX_REFRESH = "imgildev.mdx-comments.mdxCommentsRefresh";

afterEach(() => {
  resetExtensionDiscoveryForTests();
  resetExtensionRegistryForTests();
  resetExtensionAllowancesForTests();
  resetEditorExtensionSeamForTests();
  resetLuaFactoryForTests();
});

async function loadBothPacks(): Promise<void> {
  const userData = join(tmpdir(), `fulvid-live-doc-${crypto.randomUUID()}`);
  const root = join(userData, "extensions");
  await mkdir(root, { recursive: true });
  await cp(TODO_PACK, join(root, "imgildev.todo-decorator"), { recursive: true });
  await cp(MDX_PACK, join(root, "imgildev.mdx-comments"), { recursive: true });
  configureExtensionDiscovery(userData);
  setDiscoveredExtensions(await discoverExtensions());
}

type LiveState = {
  text: string;
  documentId: string;
  version: number;
  byExtension: Map<string, ExtensionDecorationRange[]>;
};

function installLiveSeam(state: LiveState): void {
  registerEditorExtensionSeam({
    getApplyContext: () => null,
    getDocumentContext: () => ({
      text: state.text,
      documentId: state.documentId,
      alternativeVersionId: state.version,
      cursorLine: 1,
      cursorColumn: 1,
    }),
    replaceSelection: () => false,
    reveal: () => false,
    setExtensionDecorations: (extensionId, ranges) => {
      state.byExtension.set(extensionId, [...ranges]);
      return true;
    },
    clearExtensionDecorations: (extensionId) => {
      state.byExtension.set(extensionId, []);
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
}

function rangesOf(state: LiveState, extensionId: string): ExtensionDecorationRange[] {
  return state.byExtension.get(extensionId) ?? [];
}

function bump(state: LiveState, text: string): void {
  state.text = text;
  state.version += 1;
}

describe("live Monaco document ↔ extension lifecycle", () => {
  test("documentSnapshotIsCurrent rejects version drift and foreign documents", () => {
    expect(
      documentSnapshotIsCurrent(
        { documentId: "a", alternativeVersionId: 1 },
        { documentId: "a", alternativeVersionId: 1 },
      ),
    ).toBe(true);
    expect(
      documentSnapshotIsCurrent(
        { documentId: "a", alternativeVersionId: 1 },
        { documentId: "a", alternativeVersionId: 2 },
      ),
    ).toBe(false);
    expect(
      documentSnapshotIsCurrent(
        { documentId: "a", alternativeVersionId: 1 },
        { documentId: "b", alternativeVersionId: 1 },
      ),
    ).toBe(false);
    expect(documentSnapshotIsCurrent({ documentId: "a", alternativeVersionId: 1 }, null)).toBe(
      false,
    );
  });

  test("both packs register as document-activation commands", async () => {
    await loadBothPacks();
    expect(
      listDocumentActivationCommands()
        .map((a) => a.namespacedId)
        .sort(),
    ).toEqual([MDX_REFRESH, TODO_REFRESH]);
  });

  test("TODO: insert, type-change, removal, multi-marker, and empty document", async () => {
    await loadBothPacks();
    const state: LiveState = {
      text: "# Note\n",
      documentId: "doc-todo",
      version: 1,
      byExtension: new Map(),
    };
    installLiveSeam(state);

    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toEqual([]);

    bump(state, "# Note\nTODO: one\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    let applied = rangesOf(state, "imgildev.todo-decorator");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      startLine: 2,
      startColumn: 1,
      endColumn: 6,
      appearance: { backgroundColor: "#d29922" },
    });

    // Change marker type in place (TODO -> FIXME): appearance and range update.
    bump(state, "# Note\nFIXME: one\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    applied = rangesOf(state, "imgildev.todo-decorator");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      startLine: 2,
      endColumn: 7,
      appearance: { backgroundColor: "#ff7b72" },
    });

    bump(state, "# Note\nFIXME: one\nBUG: two\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    applied = rangesOf(state, "imgildev.todo-decorator");
    expect(applied).toHaveLength(2);
    expect(new Set(applied.map((r) => r.appearance?.backgroundColor))).toEqual(
      new Set(["#ff7b72"]),
    );

    bump(state, "");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toEqual([]);
  });

  test("TODO: insert-above shifts marker line; fence wrap drops decoration", async () => {
    await loadBothPacks();
    const state: LiveState = {
      text: "TODO: stay\n",
      documentId: "doc-shift",
      version: 1,
      byExtension: new Map(),
    };
    installLiveSeam(state);

    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")[0]?.startLine).toBe(1);

    bump(state, "preface\n\nTODO: stay\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")[0]?.startLine).toBe(3);

    bump(state, "preface\n\n```\nTODO: stay\n```\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toEqual([]);

    bump(state, "preface\n\nTODO: stay\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")[0]?.startLine).toBe(3);
  });

  test("TODO: undo/redo and whole-document replace reconcile decorations", async () => {
    await loadBothPacks();
    const state: LiveState = {
      text: "TODO: a\n",
      documentId: "doc-undo",
      version: 1,
      byExtension: new Map(),
    };
    installLiveSeam(state);

    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toHaveLength(1);

    const beforeEdit = state.text;
    bump(state, "TODO: a\nFIXME: b\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toHaveLength(2);

    // Undo -> prior Monaco text/version.
    bump(state, beforeEdit);
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toHaveLength(1);
    expect(rangesOf(state, "imgildev.todo-decorator")[0]?.appearance?.backgroundColor).toBe(
      "#d29922",
    );

    // Redo.
    bump(state, "TODO: a\nFIXME: b\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toHaveLength(2);

    // Replace entire document.
    bump(state, "replaced without markers\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toEqual([]);
  });

  test("MDX: insert, edit tag, removal, multi-comment, and empty document", async () => {
    await loadBothPacks();
    const state: LiveState = {
      text: "# MDX\n",
      documentId: "doc-mdx",
      version: 1,
      byExtension: new Map(),
    };
    installLiveSeam(state);

    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toEqual([]);

    bump(state, "# MDX\n{/* ! critical */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    let applied = rangesOf(state, "imgildev.mdx-comments");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      startLine: 2,
      appearance: { backgroundColor: "#ff7b72" },
    });
    expect(applied[0]?.style).toBeUndefined();

    // Edit tag semantics in place (! -> ?).
    bump(state, "# MDX\n{/* ? question */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    applied = rangesOf(state, "imgildev.mdx-comments");
    expect(applied).toHaveLength(1);
    expect(applied[0]?.appearance?.backgroundColor).toBe("#4a7fc4");

    bump(state, "# MDX\n{/* ? question */}\n{/* TODO: tagged */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    applied = rangesOf(state, "imgildev.mdx-comments");
    expect(applied).toHaveLength(2);
    expect(new Set(applied.map((r) => r.appearance?.backgroundColor))).toEqual(
      new Set(["#4a7fc4", "#d29922"]),
    );

    // Untagged comment is ignored; tagged removed -> clear.
    bump(state, "# MDX\n{/* plain ignored */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toEqual([]);

    bump(state, "");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toEqual([]);
  });

  test("MDX: insert-above shifts comment range; undo/redo and replace reconcile", async () => {
    await loadBothPacks();
    const state: LiveState = {
      text: "{/* ! a */}\n",
      documentId: "doc-mdx-shift",
      version: 1,
      byExtension: new Map(),
    };
    installLiveSeam(state);

    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")[0]?.startLine).toBe(1);

    bump(state, "intro\n\n{/* ! a */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")[0]?.startLine).toBe(3);

    const withTwo = "intro\n\n{/* ! a */}\n{/* TODO: b */}\n";
    bump(state, withTwo);
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toHaveLength(2);

    bump(state, "intro\n\n{/* ! a */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toHaveLength(1);

    bump(state, withTwo);
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toHaveLength(2);

    bump(state, "cleared body only\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toEqual([]);
  });

  test("document switch isolates decorations; packs do not leak across identities", async () => {
    await loadBothPacks();
    const state: LiveState = {
      text: "TODO: alpha\n{/* ! c */}\n",
      documentId: "doc-a",
      version: 1,
      byExtension: new Map(),
    };
    installLiveSeam(state);

    await runExtensionCommand(TODO_REFRESH, { silent: true });
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toHaveLength(1);
    expect(rangesOf(state, "imgildev.mdx-comments")).toHaveLength(1);

    // Host clears editor collections on model switch; reprocess for new identity.
    state.byExtension.clear();
    state.documentId = "doc-b";
    state.version = 1;
    state.text = "FIXME: beta\n";
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toHaveLength(1);
    expect(rangesOf(state, "imgildev.todo-decorator")[0]?.appearance?.backgroundColor).toBe(
      "#ff7b72",
    );
    expect(rangesOf(state, "imgildev.mdx-comments")).toEqual([]);

    state.byExtension.clear();
    state.documentId = "doc-c";
    state.version = 1;
    state.text = "{/* ? only-mdx */}\n";
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toEqual([]);
    expect(rangesOf(state, "imgildev.mdx-comments")).toHaveLength(1);
    expect(rangesOf(state, "imgildev.mdx-comments")[0]?.appearance?.backgroundColor).toBe(
      "#4a7fc4",
    );
    expect(rangesOf(state, "imgildev.mdx-comments")[0]?.style).toBeUndefined();
  });

  test("stale live version rejects decoration apply without mutating the model", async () => {
    await loadBothPacks();
    let text = "TODO: stale\n";
    let liveVersion = 1;
    const applied: ExtensionDecorationRange[] = [];

    registerEditorExtensionSeam({
      getApplyContext: () => null,
      getDocumentContext: () => ({
        text,
        documentId: "doc-stale",
        alternativeVersionId: liveVersion,
        cursorLine: 1,
        cursorColumn: 1,
      }),
      replaceSelection: () => false,
      reveal: () => false,
      setExtensionDecorations: (_id, ranges) => {
        applied.splice(0, applied.length, ...ranges);
        return true;
      },
      clearExtensionDecorations: () => {
        applied.length = 0;
        return true;
      },
      hasActiveEditor: () => true,
    });

    let invokeCount = 0;
    configureExtensionHostActions({
      notify: () => undefined,
      createUntitled: () => undefined,
      invokeLuaCommand: async (request) => {
        invokeCount += 1;
        if (invokeCount === 1) {
          liveVersion = 2;
          text = "TODO: stale\nextra\n";
        }
        return import("../../src/bun/extensions/lua/luaExtensionRuntime.ts").then((m) =>
          m.invokeLuaExtensionCommand(request),
        );
      },
    });

    liveVersion = 1;
    await expect(runExtensionCommand(TODO_REFRESH, { silent: true })).rejects.toBeInstanceOf(
      LocalizedError,
    );
    expect(applied).toEqual([]);

    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(applied).toHaveLength(1);
  });

  test("concurrent document-pack invokes hit Lua reentrancy; sequential applies both", async () => {
    await loadBothPacks();
    const appliedByExt = new Map<string, ExtensionDecorationRange[]>();
    registerEditorExtensionSeam({
      getApplyContext: () => null,
      getDocumentContext: () => ({
        text: "TODO: one\n{/* TODO: mdx */}\n",
        documentId: "doc-concurrent",
        alternativeVersionId: 1,
        cursorLine: 1,
        cursorColumn: 1,
      }),
      replaceSelection: () => false,
      reveal: () => false,
      setExtensionDecorations: (extensionId, ranges) => {
        appliedByExt.set(extensionId, [...ranges]);
        return true;
      },
      clearExtensionDecorations: (extensionId) => {
        appliedByExt.set(extensionId, []);
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

    const commands = listDocumentActivationCommands();
    expect(commands.length).toBeGreaterThanOrEqual(2);

    const parallel = await Promise.allSettled(
      commands.map((command) => runExtensionCommand(command.namespacedId, { silent: true })),
    );
    expect(parallel.some((entry) => entry.status === "rejected")).toBe(true);

    appliedByExt.clear();
    for (const command of commands) {
      await runExtensionCommand(command.namespacedId, { silent: true });
    }
    expect((appliedByExt.get("imgildev.todo-decorator") ?? []).length).toBeGreaterThan(0);
    expect((appliedByExt.get("imgildev.mdx-comments") ?? []).length).toBeGreaterThan(0);
  });
});
