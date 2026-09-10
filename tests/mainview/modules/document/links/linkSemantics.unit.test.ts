import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  buildFocusGraph,
  noteConnections,
  resolveDocumentPath,
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

/**
 * Resolution used to rescan the whole note list per link - once for the exact
 * path, again to rebuild the stem map, then for aliases and titles. That made a
 * folder-wide pass quadratic: 2000 notes took over ten seconds, and the scanner
 * allows 5000. These hold the shape of the cost, and that indexing did not
 * change which note a link resolves to.
 */
describe("resolution scale", () => {
  function linkedNotes(count: number, linksPerNote: number): ScannedNote[] {
    return Array.from({ length: count }, (_, index) => ({
      path: `n${index}.md`,
      name: `n${index}.md`,
      title: `Title ${index}`,
      aliases: [`alias-${index}`],
      documentLinks: Array.from({ length: linksPerNote }, (_, offset) => ({
        syntax: "markdown" as const,
        raw: `[x](n${(index + offset) % count}.md)`,
        target: `n${(index + offset) % count}.md`,
        range: { start: 0, end: 0 },
      })),
      tags: [],
      categories: [],
      projects: [],
      summary: "",
      tokens: 0,
      words: 0,
    }));
  }

  test("a folder-wide pass stays near-linear in folder size", () => {
    const small = linkedNotes(250, 10);
    const large = linkedNotes(2_000, 10);

    const smallStarted = performance.now();
    expect(resolveWorkspaceEdges(small)).toHaveLength(2_250);
    const smallMs = performance.now() - smallStarted;

    const largeStarted = performance.now();
    expect(resolveWorkspaceEdges(large)).toHaveLength(18_000);
    const largeMs = performance.now() - largeStarted;

    // Eight times the folder, quadratically was ~64x the work. Allow generous
    // headroom for a loaded machine while still failing on a return to O(n^2).
    expect(largeMs).toBeLessThan(Math.max(smallMs * 16, 1_500));
  });

  test("indexing resolves to the same note as scanning did", () => {
    const notes = linkedNotes(50, 1);

    // Each of the four resolution routes still lands on its own note.
    expect(resolveDocumentPath("n7.md", notes, "both").path).toBe("n7.md");
    expect(resolveDocumentPath("n7.md", notes, "both").reason).toBe("exact-path");
    expect(resolveDocumentPath("n7", notes, "both").reason).toBe("stem");
    expect(resolveDocumentPath("alias-9", notes, "both").path).toBe("n9.md");
    expect(resolveDocumentPath("Title 11", notes, "both").path).toBe("n11.md");
    expect(resolveDocumentPath("nothing-here", notes, "both").path).toBeNull();
  });

  test("the first matching note still wins on a duplicate title", () => {
    const base = linkedNotes(2, 0);
    const duplicated: ScannedNote[] = [
      { ...base[0], path: "first.md", name: "first.md", title: "Shared", aliases: ["dup"] },
      { ...base[1], path: "second.md", name: "second.md", title: "Shared", aliases: ["dup"] },
    ];

    expect(resolveDocumentPath("Shared", duplicated, "both").path).toBe("first.md");
    expect(resolveDocumentPath("dup", duplicated, "both").path).toBe("first.md");
  });

  test("a rescan is indexed afresh rather than answering from the old folder", () => {
    const before = linkedNotes(3, 0);
    expect(resolveDocumentPath("Title 1", before, "both").path).toBe("n1.md");

    // A new array is what a rescan produces; resolution must follow it.
    const after = before.map((note) => ({ ...note, path: `moved/${note.path}` }));
    expect(resolveDocumentPath("Title 1", after, "both").path).toBe("moved/n1.md");
  });
});
