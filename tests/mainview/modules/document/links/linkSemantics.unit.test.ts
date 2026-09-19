import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import {
  ambiguousOutboundLinks,
  buildFocusGraph,
  documentLinkNavigationPath,
  noteConnections,
  resolveDocumentPath,
  resolveWorkspaceEdges,
  uniqueLinkCandidate,
  unresolvedDocumentLinks,
  setDocumentLinkSettings,
} from "../../../../../src/mainview/modules/document/links/linkSemantics";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink.ts";
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
    words: 0,
    ...overrides,
  };
}

function indexedNote(index: number): ScannedNote {
  return note(`n${index}.md`, [], {
    title: `Title ${index}`,
    aliases: [`alias-${index}`],
  });
}

// Intent: protect resolved-edge and graph semantics at the pure-logic boundary.
describe("link semantics", () => {
  beforeEach(() => {
    setDocumentLinkSettings({ linkMode: "wikilink", resolution: "both" });
  });

  afterEach(() => {
    setDocumentLinkSettings({ linkMode: "markdown", resolution: "both" });
  });

  test("link graph and indexing resolve consistently under mode, depth, and ambiguity", () => {
    const notes = [note("a.md", ["b"]), note("b.md", ["c"]), note("c.md")];
    expect(buildFocusGraph("a.md", notes, 1)).toEqual({
      focusPath: "a.md",
      nodes: [
        { id: "a.md", label: "a" },
        { id: "b.md", label: "b" },
      ],
      edges: [{ source: "a.md", target: "b.md" }],
    });

    const mixed = [note("a.md", ["b", "c"]), note("b.md"), note("c.md")];
    mixed[0].documentLinks = [
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
    expect(resolveWorkspaceEdges(mixed)).toEqual([{ source: "a.md", target: "c.md" }]);
    setDocumentLinkSettings({ linkMode: "markdown", resolution: "both" });
    expect(resolveWorkspaceEdges(mixed)).toEqual([{ source: "a.md", target: "b.md" }]);

    setDocumentLinkSettings({ linkMode: "wikilink", resolution: "both" });
    const noisy = [note("a.md", ["b", "b", "missing", "a"]), note("b.md")];
    expect(resolveWorkspaceEdges(noisy)).toEqual([{ source: "a.md", target: "b.md" }]);
    expect(noteConnections("b.md", noisy)).toEqual({
      references: [],
      referencedBy: ["a.md"],
    });
    expect(unresolvedDocumentLinks(noisy[0], noisy)).toEqual(["missing"]);

    const indexed = [0, 7, 9, 11].map(indexedNote);
    expect(resolveDocumentPath("n7.md", indexed, "both").path).toBe("n7.md");
    expect(resolveDocumentPath("n7.md", indexed, "both").reason).toBe("exact-path");
    expect(resolveDocumentPath("n7", indexed, "both").reason).toBe("stem");
    expect(resolveDocumentPath("alias-9", indexed, "both").path).toBe("n9.md");
    expect(resolveDocumentPath("Title 11", indexed, "both").path).toBe("n11.md");
    expect(resolveDocumentPath("nothing-here", indexed, "both").path).toBeNull();

    const duplicated: ScannedNote[] = [
      { ...indexed[0], path: "first.md", name: "first.md", title: "Shared", aliases: ["dup"] },
      { ...indexed[1], path: "second.md", name: "second.md", title: "Shared", aliases: ["dup"] },
    ];
    expect(resolveDocumentPath("Shared", duplicated, "both").path).toBe("first.md");
    expect(resolveDocumentPath("dup", duplicated, "both").path).toBe("first.md");
    expect(resolveDocumentPath("Shared", duplicated, "both").alsoMatches).toEqual(["second.md"]);
    expect(resolveDocumentPath("dup", duplicated, "both").alsoMatches).toEqual(["second.md"]);

    const before = [0, 1, 2].map(indexedNote);
    expect(resolveDocumentPath("Title 1", before, "both").path).toBe("n1.md");
    const after = before.map((entry) => ({ ...entry, path: `moved/${entry.path}` }));
    expect(resolveDocumentPath("Title 1", after, "both").path).toBe("moved/n1.md");

    const stemDupes = [
      note("docs/guide.md", [], { name: "guide.md", title: "Guide A" }),
      note("archive/guide.md", [], { name: "guide.md", title: "Guide B" }),
    ];
    const resolved = resolveDocumentPath("guide", stemDupes, "both");
    expect(resolved.path).toBe("docs/guide.md");
    expect(resolved.reason).toBe("stem");
    expect(resolved.alsoMatches).toEqual(["archive/guide.md"]);
    expect(ambiguousOutboundLinks(note("index.md", ["guide"]), stemDupes)).toEqual([
      {
        target: "guide",
        path: "docs/guide.md",
        alsoMatches: ["archive/guide.md"],
      },
    ]);

    const exact = resolveDocumentPath("archive/guide", stemDupes, "both");
    expect(exact.path).toBe("archive/guide.md");
    expect(exact.alsoMatches).toEqual([]);

    const candidates = [
      note("alpha.md", [], { title: "Alpha Note" }),
      note("beta.md", [], { title: "Beta Note" }),
      note("gamma.md", [], { title: "Gamma" }),
    ];
    expect(uniqueLinkCandidate("Alpha Note", candidates)).toEqual({
      path: "alpha.md",
      reason: "title",
    });
    expect(uniqueLinkCandidate("Note", candidates)).toBeNull();
    expect(uniqueLinkCandidate("missing", candidates)).toBeNull();

    const link = (target: string): DocumentLink => ({
      syntax: "markdown",
      raw: `[x](${target})`,
      target,
      range: { start: 0, end: target.length + 5 },
    });
    // Soft-open navigation: unique near-match opens; zero/multi stay non-navigable.
    expect(documentLinkNavigationPath(link("Alpha Note"), candidates)).toBe("alpha.md");
    expect(documentLinkNavigationPath(link("Note"), candidates)).toBeNull();
    expect(documentLinkNavigationPath(link("missing"), candidates)).toBeNull();
    expect(documentLinkNavigationPath(link("alpha.md"), candidates)).toBe("alpha.md");
  });
});
