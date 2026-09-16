import { describe, expect, test } from "bun:test";

import { quickOpenCandidatesFromNotes } from "../../../../src/mainview/modules/quickOpen/quickOpenCandidates.ts";
import type { ScannedNote } from "../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function note(
  partial: Partial<ScannedNote> & Pick<ScannedNote, "path" | "name" | "title">,
): ScannedNote {
  return {
    aliases: [],
    documentLinks: [],
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    words: 0,
    content: "should not appear in candidates",
    ...partial,
  };
}

// Intent: Quick Open projects folder-scan identity only; never content; empty when no notes.
describe("quick open candidates", () => {
  test("projects title, filename, and relative path without content", () => {
    expect(quickOpenCandidatesFromNotes([])).toEqual([]);

    const candidates = quickOpenCandidatesFromNotes([
      note({ path: "docs/guide.md", name: "guide.md", title: "Guide" }),
    ]);

    expect(candidates).toEqual([{ title: "Guide", name: "guide.md", path: "docs/guide.md" }]);
    expect(candidates[0]).not.toHaveProperty("content");
  });
});
