import { describe, expect, test } from "bun:test";

import {
  explorerParentPath,
  isCurrentExplorerListSession,
  reconcileExplorerDirectoryState,
} from "../../../../../src/mainview/modules/workspace/explorer/explorerListSession.ts";
import type { FileSystemEntry } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function directory(path: string): FileSystemEntry {
  const name = path.split("/").pop() ?? path;
  return { kind: "directory", name, path, hidden: false };
}

function file(path: string): FileSystemEntry {
  const name = path.split("/").pop() ?? path;
  return { kind: "file", name, path, hidden: false };
}

// Intent: Explorer list/refresh must not apply stale async results, and a
// parent re-list must drop expansion/cache for directories that disappeared.
describe("explorer list session", () => {
  test("stale sessions ignored; reconciliation prunes vanished dirs and preserves unrelated expansion", () => {
    expect(isCurrentExplorerListSession(1, 1, "/ws", "/ws")).toBe(true);
    expect(isCurrentExplorerListSession(1, 2, "/ws", "/ws")).toBe(false);
    expect(isCurrentExplorerListSession(1, 1, "/ws-a", "/ws-b")).toBe(false);
    expect(isCurrentExplorerListSession(1, 1, null, "/ws")).toBe(false);
    expect(isCurrentExplorerListSession(1, 1, "/ws", null)).toBe(false);
    expect(explorerParentPath("notes/a.md")).toBe("notes");
    expect(explorerParentPath("a.md")).toBe("");
    expect(explorerParentPath("notes/deep/a.md")).toBe("notes/deep");

    const previous = {
      "": [directory("keep"), directory("gone"), file("root.md")],
      keep: [file("keep/a.md")],
      gone: [directory("gone/nested"), file("gone/b.md")],
      "gone/nested": [file("gone/nested/c.md")],
    };
    const expanded = new Set(["keep", "gone", "gone/nested"]);

    const pruned = reconcileExplorerDirectoryState(
      "",
      [directory("keep"), file("root.md")],
      previous,
      expanded,
    );

    expect(pruned.entriesByDirectory[""]?.map((entry) => entry.path)).toEqual(["keep", "root.md"]);
    expect(pruned.entriesByDirectory.keep).toEqual([file("keep/a.md")]);
    expect(pruned.entriesByDirectory.gone).toBeUndefined();
    expect(pruned.entriesByDirectory["gone/nested"]).toBeUndefined();
    expect([...pruned.expandedDirectories].sort()).toEqual(["keep"]);

    const nestedPrevious = {
      "": [directory("alpha"), directory("beta")],
      alpha: [directory("alpha/child"), file("alpha/a.md")],
      "alpha/child": [file("alpha/child/c.md")],
      beta: [file("beta/b.md")],
    };
    const nestedExpanded = new Set(["alpha", "alpha/child", "beta"]);

    const nested = reconcileExplorerDirectoryState(
      "alpha",
      [file("alpha/a.md")],
      nestedPrevious,
      nestedExpanded,
    );

    expect(nested.entriesByDirectory.alpha?.map((entry) => entry.path)).toEqual(["alpha/a.md"]);
    expect(nested.entriesByDirectory["alpha/child"]).toBeUndefined();
    expect(nested.expandedDirectories.has("alpha")).toBe(true);
    expect(nested.expandedDirectories.has("alpha/child")).toBe(false);
    expect(nested.expandedDirectories.has("beta")).toBe(true);
    expect(nested.entriesByDirectory.beta).toEqual([file("beta/b.md")]);
  });
});
