import { describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import { projectReferenceGraph } from "../../../../../src/mainview/modules/graph/core/graphProjection";
import {
  graphActiveTargetFromInputs,
  type GraphActiveBufferInput,
} from "../../../../../src/mainview/modules/graph/active-document/graphActiveDocumentProjection.ts";

function note(path: string, title = path, documentLinks: DocumentLink[] = []): ScannedNote {
  return {
    path,
    name: path,
    title,
    aliases: [],
    documentLinks,
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    words: 0,
  };
}

function link(target: string): DocumentLink {
  return {
    syntax: "markdown",
    raw: `[${target}](${target})`,
    target,
    range: { start: 0, end: target.length + 4 },
  };
}

function buffer(
  id: string,
  options: {
    path?: string | null;
    rootPath?: string | null;
    title: string;
  },
): GraphActiveBufferInput {
  return {
    id,
    absolutePath: options.path ? `/tmp/workspace/${options.path}` : null,
    rootPath: options.rootPath ?? null,
    path: options.path ?? null,
    title: options.title,
  };
}

// Intent: Graph consumes Focus for folder projection; the active tab is not
// a second selection authority. Virtual documents may project alone.
describe("graph active document", () => {
  test("folder Graph follows Focus, not the active tab; virtual documents project alone", () => {
    expect(
      graphActiveTargetFromInputs(
        null,
        buffer("untitled:1", { path: null, rootPath: null, title: "Untitled" }),
        null,
        [],
      ),
    ).toEqual({
      focusPath: "untitled:1",
      notes: [{ ...note("untitled:1", "Untitled"), name: "Untitled" }],
      title: "Untitled",
    });

    const notes = [note("first.md", "First"), note("second.md", "Second")];
    const editingFirst = buffer("file:/tmp/workspace/first.md", {
      path: "first.md",
      rootPath: "/tmp/workspace",
      title: "First",
    });
    expect(
      graphActiveTargetFromInputs({ path: "second.md" }, editingFirst, "/tmp/workspace", notes)
        ?.focusPath,
    ).toBe("second.md");
    expect(graphActiveTargetFromInputs(null, editingFirst, "/tmp/workspace", notes)).toBeNull();
  });

  test("projects linked folder documents into nodes and edges from Focus", () => {
    const notes = [note("a.md", "A", [link("b.md")]), note("b.md", "B", [link("a.md")])];
    const target = graphActiveTargetFromInputs(
      { path: "a.md" },
      buffer("file:/tmp/workspace/a.md", {
        path: "a.md",
        rootPath: "/tmp/workspace",
        title: "A",
      }),
      "/tmp/workspace",
      notes,
    );
    const graph = projectReferenceGraph(target!.focusPath, [...target!.notes], { depth: 2 });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["a.md", "b.md"]);
    expect(graph.edges).toEqual([
      { source: "a.md", target: "b.md" },
      { source: "b.md", target: "a.md" },
    ]);
  });
});
