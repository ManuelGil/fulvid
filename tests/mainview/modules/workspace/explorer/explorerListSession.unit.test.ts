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
  test("session validity requires matching generation and workspace root", () => {
    expect(isCurrentExplorerListSession(1, 1, "/ws", "/ws")).toBe(true);
    expect(isCurrentExplorerListSession(1, 2, "/ws", "/ws")).toBe(false);
    expect(isCurrentExplorerListSession(1, 1, "/ws-a", "/ws-b")).toBe(false);
    expect(isCurrentExplorerListSession(1, 1, null, "/ws")).toBe(false);
    expect(isCurrentExplorerListSession(1, 1, "/ws", null)).toBe(false);
    expect(explorerParentPath("notes/a.md")).toBe("notes");
    expect(explorerParentPath("a.md")).toBe("");
    expect(explorerParentPath("notes/deep/a.md")).toBe("notes/deep");
  });

  test("reconciliation removes expansion and cache for vanished child directories", () => {
    const previous = {
      "": [directory("keep"), directory("gone"), file("root.md")],
      keep: [file("keep/a.md")],
      gone: [directory("gone/nested"), file("gone/b.md")],
      "gone/nested": [file("gone/nested/c.md")],
    };
    const expanded = new Set(["keep", "gone", "gone/nested"]);

    const next = reconcileExplorerDirectoryState(
      "",
      [directory("keep"), file("root.md")],
      previous,
      expanded,
    );

    expect(next.entriesByDirectory[""]?.map((entry) => entry.path)).toEqual(["keep", "root.md"]);
    expect(next.entriesByDirectory.keep).toEqual([file("keep/a.md")]);
    expect(next.entriesByDirectory.gone).toBeUndefined();
    expect(next.entriesByDirectory["gone/nested"]).toBeUndefined();
    expect([...next.expandedDirectories].sort()).toEqual(["keep"]);
  });

  test("reconciliation keeps unrelated expansion when a nested listing updates", () => {
    const previous = {
      "": [directory("alpha"), directory("beta")],
      alpha: [directory("alpha/child"), file("alpha/a.md")],
      "alpha/child": [file("alpha/child/c.md")],
      beta: [file("beta/b.md")],
    };
    const expanded = new Set(["alpha", "alpha/child", "beta"]);

    const next = reconcileExplorerDirectoryState("alpha", [file("alpha/a.md")], previous, expanded);

    expect(next.entriesByDirectory.alpha?.map((entry) => entry.path)).toEqual(["alpha/a.md"]);
    expect(next.entriesByDirectory["alpha/child"]).toBeUndefined();
    expect(next.expandedDirectories.has("alpha")).toBe(true);
    expect(next.expandedDirectories.has("alpha/child")).toBe(false);
    expect(next.expandedDirectories.has("beta")).toBe(true);
    expect(next.entriesByDirectory.beta).toEqual([file("beta/b.md")]);
  });
});
