import { describe, expect, test } from "bun:test";

import type { QuickOpenCandidate } from "../../../../src/mainview/modules/quickOpen/quickOpenCandidates.ts";
import { quickOpenCandidatesFromNotes } from "../../../../src/mainview/modules/quickOpen/quickOpenCandidates.ts";
import {
  MAX_QUICK_OPEN_VISIBLE,
  matchQuickOpenCandidates,
} from "../../../../src/mainview/modules/quickOpen/quickOpenMatch.ts";
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

function candidate(
  partial: Pick<QuickOpenCandidate, "title" | "name" | "path">,
): QuickOpenCandidate {
  return partial;
}

// Intent: Quick Open is identity-only matching with a bounded visible set.
describe("quick open", () => {
  test("projects identity without content and matches with prefix preference and a visible cap", () => {
    const candidates = quickOpenCandidatesFromNotes([
      note({ path: "docs/guide.md", name: "guide.md", title: "Guide" }),
    ]);
    expect(candidates).toEqual([{ title: "Guide", name: "guide.md", path: "docs/guide.md" }]);
    expect(candidates[0]).not.toHaveProperty("content");

    const notes = [
      candidate({ title: "Architecture", name: "architecture.md", path: "docs/architecture.md" }),
      candidate({ title: "Guide", name: "guide.md", path: "docs/guide.md" }),
      candidate({ title: "API Notes", name: "api.md", path: "notes/api.md" }),
    ];
    expect(matchQuickOpenCandidates(notes, "GUIDE").matches.map((item) => item.path)).toEqual([
      "docs/guide.md",
    ]);
    expect(matchQuickOpenCandidates(notes, "docs\\guide").matches.map((item) => item.path)).toEqual(
      ["docs/guide.md"],
    );
    expect(matchQuickOpenCandidates(notes, "api").matches.map((item) => item.path)).toEqual([
      "notes/api.md",
    ]);

    const many = Array.from({ length: MAX_QUICK_OPEN_VISIBLE + 5 }, (_, index) =>
      candidate({
        title: `Note ${index}`,
        name: `note-${index}.md`,
        path: `n/note-${String(index).padStart(3, "0")}.md`,
      }),
    );
    const capped = matchQuickOpenCandidates(many, "");
    expect(capped.total).toBe(MAX_QUICK_OPEN_VISIBLE + 5);
    expect(capped.matches).toHaveLength(MAX_QUICK_OPEN_VISIBLE);
  });
});
