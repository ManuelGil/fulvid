import { describe, expect, test } from "bun:test";

import type { ScannedNote } from "../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import {
  groupSearchHits,
  highlightSearchSnippet,
  searchDocuments,
  searchQueryIssue,
} from "../../../../src/mainview/modules/search/searchResults";

function note(path: string, content: string): ScannedNote {
  return {
    path,
    name: path.split("/").pop() ?? path,
    title: "Document",
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

// Intent: preserve body-search coordinates and snippets.
// Growth boundary: add cases only for new matching or ranking rules.
describe("global document search", () => {
  test("finds text that exists only in the document body", () => {
    const hits = searchDocuments(
      [
        note("guide.md", "# Guide\n\nThe unique phrase is here."),
        note("other.md", "# Other\n\nNo match."),
      ],
      "unique phrase",
    );

    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      note: { path: "guide.md" },
      match: {
        lineNumber: 3,
        column: 5,
        snippet: "The unique phrase is here.",
      },
    });
  });

  test("keeps every match in a document and groups them together", () => {
    const hits = searchDocuments(
      [note("twice.md", "alpha\nalpha later\nnope"), note("once.md", "alpha only")],
      "alpha",
    );

    expect(hits).toHaveLength(3);
    expect(groupSearchHits(hits).map((group) => [group.note.path, group.matches.length])).toEqual([
      ["twice.md", 2],
      ["once.md", 1],
    ]);
  });

  // Intent: case, word, and regex are real engine options, not decorative toggles.
  // Growth boundary: add cases only for a new matching flag.
  test("honors case sensitive, whole word, and regular expression matching", () => {
    const notes = [note("words.md", "Search searching SEARCH")];

    expect(searchDocuments(notes, "search", { caseSensitive: true })).toHaveLength(1);
    expect(
      searchDocuments(notes, "search", { wholeWord: true }).map((hit) => hit.match.offset),
    ).toEqual([0, 17]);
    expect(searchDocuments(notes, "search(ing)?", { regex: true })).toHaveLength(3);
    expect(searchQueryIssue("(unclosed", { regex: true })).toBe("invalidRegex");
    expect(searchDocuments(notes, "(unclosed", { regex: true })).toEqual([]);
  });

  // Intent: highlight keeps markup as text so snippets cannot inject HTML.
  // Growth boundary: add cases only if snippet highlighting changes its output shape.
  test("highlights matches without interpreting document markup", () => {
    expect(highlightSearchSnippet("See <em>todo</em> here", "em")).toEqual([
      { text: "See <", match: false },
      { text: "em", match: true },
      { text: ">todo</", match: false },
      { text: "em", match: true },
      { text: "> here", match: false },
    ]);
  });
});
