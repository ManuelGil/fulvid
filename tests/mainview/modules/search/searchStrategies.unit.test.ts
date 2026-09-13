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
    words: 0,
    content,
  };
}

// Intent: extra strategies change matches without inventing a second document parser.
describe("search strategies", () => {
  test("fuzzy, boolean, proximity, and structure strategies reuse document fields", () => {
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

    const content =
      '---\n"title": Quoted\ntitle: Guide\n---\n# Getting started\n\nSee [other](other.md) and [[notes]].\n\n```ts\nconst x = 1\n# Not a heading\n- fake item\n```\n\n- item one\n';
    const structured = [note("docs/guide.md", content, "Getting started")];
    const structure = parseMarkdownStructure(content);
    const markdownLink = parseDocumentLinks(content, "markdown")[0];

    expect(
      searchDocuments(structured, "started", { strategy: "pattern", patternKind: "heading" })[0]
        ?.match.lineNumber,
    ).toBe(structure.headings[0]?.lineNumber);
    expect(
      searchDocuments(structured, "other", { strategy: "pattern", patternKind: "link" })[0]?.match
        .offset,
    ).toBe(markdownLink?.range.start);
    expect(searchDocuments(structured, "guide", { strategy: "path" })[0]?.match.kind).toBe("path");
  });
});
