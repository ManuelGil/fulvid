import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  buildFocusGraph,
  noteConnections,
  resolveWorkspaceEdges,
  unresolvedDocumentLinks,
  setDocumentLinkSettings,
} from "../../../../../src/mainview/modules/document/links/linkSemantics";

import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function note(
  path: string,
  links: string[] = [],
  overrides: Partial<ScannedNote> = {},
): ScannedNote {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    title: name.replace(/\.(md|markdown|mdx)$/i, ""),
    aliases: [],
    documentLinks: links.map((target, index) => ({
      syntax: "wikilink" as const,
      raw: `[[${target}]]`,
      target,
      range: { start: index, end: index + target.length + 4 },
    })),
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    tokens: 0,
    words: 0,
    ...overrides,
  };
}

// Intent: protect resolved-edge and graph semantics at the pure-logic boundary.
// Growth boundary: add cases only for a new link or graph policy.
describe("link semantics", () => {
  beforeEach(() => {
    setDocumentLinkSettings({ linkMode: "wikilink", resolution: "both" });
  });

  afterEach(() => {
    setDocumentLinkSettings({ linkMode: "markdown", resolution: "both" });
  });

  test("builds a depth-limited graph from resolved document links", () => {
    const notes = [note("a.md", ["b"]), note("b.md", ["c"]), note("c.md")];

    expect(buildFocusGraph("a.md", notes, 1)).toEqual({
      focusPath: "a.md",
      nodes: [
        { id: "a.md", label: "a" },
        { id: "b.md", label: "b" },
      ],
      edges: [{ source: "a.md", target: "b.md" }],
    });
  });

  test("honors linkMode when resolving workspace edges", () => {
    const notes = [note("a.md", ["b", "c"]), note("b.md"), note("c.md")];
    notes[0].documentLinks = [
      {
        syntax: "markdown",
        raw: "[b](b.md)",
        target: "b.md",
        range: { start: 0, end: 10 },
      },
      {
        syntax: "wikilink",
        raw: "[[c]]",
        target: "c",
        range: { start: 11, end: 17 },
      },
    ];

    setDocumentLinkSettings({ linkMode: "wikilink", resolution: "both" });
    expect(resolveWorkspaceEdges(notes)).toEqual([{ source: "a.md", target: "c.md" }]);

    setDocumentLinkSettings({ linkMode: "markdown", resolution: "both" });
    expect(resolveWorkspaceEdges(notes)).toEqual([{ source: "a.md", target: "b.md" }]);
  });

  test("deduplicates workspace edges and ignores unresolved or self links", () => {
    const notes = [note("a.md", ["b", "b", "missing", "a"]), note("b.md")];

    expect(resolveWorkspaceEdges(notes)).toEqual([{ source: "a.md", target: "b.md" }]);
    expect(noteConnections("a.md", notes)).toEqual({
      references: ["b.md"],
      referencedBy: [],
    });
    expect(noteConnections("b.md", notes)).toEqual({
      references: [],
      referencedBy: ["a.md"],
    });
    expect(unresolvedDocumentLinks(notes[0], notes)).toEqual(["missing"]);
  });
});
