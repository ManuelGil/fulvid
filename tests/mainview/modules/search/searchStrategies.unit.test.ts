import { describe, expect, test } from "bun:test";

import { parseDocumentLinks } from "../../../../src/mainview/modules/document/links/documentLink.ts";
import { parseMarkdownStructure } from "../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";
import type { ScannedNote } from "../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import {
  searchDocuments,
  searchQueryIssue,
} from "../../../../src/mainview/modules/search/searchResults.ts";

function note(path: string, content: string, title = "Document"): ScannedNote {
  return {
    path,
    name: path.split("/").pop() ?? path,
    title,
    aliases: [],
    documentLinks: [],
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    tokens: 0,
    words: 0,
    content,
  };
}

// Intent: extra strategies must change matches without a second document parser.
// Growth boundary: add a case only when a strategy's matching rule changes.
describe("search strategies", () => {
  test("finds approximate words, combined terms, and nearby terms", () => {
    const notes = [
      note("fuzzy.md", "The recieve function failed"),
      note("both.md", "alpha later beta"),
      note("or.md", "only beta here"),
      note("far.md", "alpha one two three four five six seven eight nine beta"),
    ];

    expect(searchDocuments(notes, "receive", { strategy: "fuzzy" })[0]?.note.path).toBe("fuzzy.md");
    expect(
      new Set(
        searchDocuments(notes, "alpha beta", { strategy: "boolean", booleanMode: "and" }).map(
          (hit) => hit.note.path,
        ),
      ),
    ).toEqual(new Set(["both.md", "far.md"]));
    expect(
      searchDocuments(notes, "alpha beta", { strategy: "proximity", proximity: 4 }).map(
        (hit) => hit.note.path,
      ),
    ).toEqual(["both.md"]);
    expect(searchQueryIssue("alpha", { strategy: "proximity" })).toBe("invalidPattern");
  });

  test("reuses document structure and path fields instead of a second parser", () => {
    const content =
      '---\n"title": Quoted\ntitle: Guide\n---\n# Getting started\n\nSee [other](other.md) and [[notes]].\n\n```ts\nconst x = 1\n# Not a heading\n- fake item\n```\n\n- item one\n';
    const notes = [note("docs/guide.md", content, "Getting started")];
    const structure = parseMarkdownStructure(content);
    const markdownLink = parseDocumentLinks(content, "markdown")[0];

    const heading = searchDocuments(notes, "started", {
      strategy: "pattern",
      patternKind: "heading",
    })[0];
    expect(heading?.match.lineNumber).toBe(structure.headings[0]?.lineNumber);
    expect(
      searchDocuments(notes, "heading", { strategy: "pattern", patternKind: "heading" }),
    ).toHaveLength(0);

    const link = searchDocuments(notes, "other", { strategy: "pattern", patternKind: "link" })[0];
    expect(link?.match.offset).toBe(markdownLink?.range.start);

    expect(
      searchDocuments(notes, "ts", { strategy: "pattern", patternKind: "fence" })[0]?.match
        .lineNumber,
    ).toBe(structure.fences[0]?.startLine);
    expect(searchDocuments(notes, "guide", { strategy: "path" })[0]?.match.kind).toBe("path");
  });
});
