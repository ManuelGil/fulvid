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
    words: 0,
    content,
  };
}

// Intent: body-search coordinates, matching flags, and inert snippets.
// Snippet highlighting must treat markup as plain text — never as HTML.
describe("global document search", () => {
  test("finds and groups body matches with matching flags, treating markup as plain text", () => {
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
      match: { lineNumber: 3, column: 5, snippet: "The unique phrase is here." },
    });

    const multi = searchDocuments(
      [note("twice.md", "alpha\nalpha later\nnope"), note("once.md", "alpha only")],
      "alpha",
    );
    expect(multi).toHaveLength(3);
    expect(groupSearchHits(multi).map((group) => [group.note.path, group.matches.length])).toEqual([
      ["twice.md", 2],
      ["once.md", 1],
    ]);

    expect(highlightSearchSnippet("See <em>todo</em> here", "em")).toEqual([
      { text: "See <", match: false },
      { text: "em", match: true },
      { text: ">todo</", match: false },
      { text: "em", match: true },
      { text: "> here", match: false },
    ]);

    const words = [note("words.md", "Search searching SEARCH")];
    expect(searchDocuments(words, "search", { caseSensitive: true })).toHaveLength(1);
    expect(
      searchDocuments(words, "search", { wholeWord: true }).map((hit) => hit.match.offset),
    ).toEqual([0, 17]);
    expect(searchDocuments(words, "search(ing)?", { regex: true })).toHaveLength(3);
    expect(searchQueryIssue("(unclosed", { regex: true })).toBe("invalidRegex");
  });
});
