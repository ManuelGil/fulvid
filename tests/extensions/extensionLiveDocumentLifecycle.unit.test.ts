/**
 * Live Monaco document contract for document-oriented extensions:
 * snapshots come from the seam (live text + stamps), not the filesystem.
 * Keep one registration/currency seam and one mutate/stale/isolation lifecycle.
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

function installLiveSeam(state: LiveState, onNotify: () => void = () => undefined): void {
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
    notify: onNotify,
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

describe("live Monaco document and extension lifecycle", () => {
  test("snapshot currency rejects drift; both packs register as document-activation", async () => {
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

    await loadBothPacks();
    expect(
      listDocumentActivationCommands()
        .map((a) => a.namespacedId)
        .sort(),
    ).toEqual([MDX_REFRESH, TODO_REFRESH]);
  });

  test("live insert/decorate, doc-switch isolation, stale version reject, concurrent reentrancy", async () => {
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
    const applied = rangesOf(state, "imgildev.todo-decorator");
    expect(applied).toHaveLength(1);
    expect(applied[0]).toMatchObject({
      startLine: 2,
      startColumn: 1,
      endColumn: 6,
      appearance: { backgroundColor: "#d29922" },
    });

    // Fence removal clears TODO decorations (inertness smoke).
    bump(state, "preface\n\n```\nTODO: one\n```\n");
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.todo-decorator")).toEqual([]);

    // Short MDX assertion for tagged-comment inertness vs plain.
    bump(state, "# MDX\n{/* ! critical */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toHaveLength(1);
    expect(rangesOf(state, "imgildev.mdx-comments")[0]).toMatchObject({
      appearance: { backgroundColor: "#ff7b72" },
    });
    bump(state, "# MDX\n{/* plain ignored */}\n");
    await runExtensionCommand(MDX_REFRESH, { silent: true });
    expect(rangesOf(state, "imgildev.mdx-comments")).toEqual([]);

    // Document switch isolates decorations across identities.
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
    expect(rangesOf(state, "imgildev.mdx-comments")[0]?.style).toBeUndefined();

    // Stale live version rejects decoration apply without mutating the model.
    let text = "TODO: stale\n";
    let liveVersion = 1;
    const staleApplied: ExtensionDecorationRange[] = [];
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
        staleApplied.splice(0, staleApplied.length, ...ranges);
        return true;
      },
      clearExtensionDecorations: () => {
        staleApplied.length = 0;
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
    expect(staleApplied).toEqual([]);
    await runExtensionCommand(TODO_REFRESH, { silent: true });
    expect(staleApplied).toHaveLength(1);

    // Concurrent document-pack invokes hit Lua reentrancy; sequential applies both.
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
