import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import {
  buildFocusGraph,
  setDocumentLinkSettings,
} from "../../../../../src/mainview/modules/document/links/linkSemantics";
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
  beforeEach(() => {
    setDocumentLinkSettings({ linkMode: "markdown", resolution: "both" });
  });

  afterEach(() => {
    setDocumentLinkSettings({ linkMode: "markdown", resolution: "both" });
  });

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

  // Intent: undirected Graph membership ≠ directed Context reach (GRAPH.md).
  // An incoming-only neighbor must appear on Graph and stay out of buildFocusGraph.
  test("incoming-only neighbors appear on Graph but not in directed Context reach", () => {
    const notes = [note("a.md", "A"), note("b.md", "B", [link("a.md")])];
    const graph = projectReferenceGraph("a.md", notes, { depth: 1 });
    expect(graph.nodes.map((node) => node.id).sort()).toEqual(["a.md", "b.md"]);
    expect(graph.edges).toEqual([{ source: "b.md", target: "a.md" }]);
    expect(buildFocusGraph("a.md", notes, 1)).toEqual({
      focusPath: "a.md",
      nodes: [{ id: "a.md", label: "A" }],
      edges: [],
    });
  });
});
