import { describe, expect, test } from "bun:test";

import type { QuickOpenCandidate } from "../../../../src/mainview/modules/quickOpen/quickOpenCandidates.ts";
import {
  MAX_QUICK_OPEN_VISIBLE,
  matchQuickOpenCandidates,
} from "../../../../src/mainview/modules/quickOpen/quickOpenMatch.ts";

function candidate(
  partial: Pick<QuickOpenCandidate, "title" | "name" | "path">,
): QuickOpenCandidate {
  return partial;
}

// Intent: matching is identity-only, case-insensitive, and deterministically ordered.
describe("quick open matching", () => {
  const notes = [
    candidate({ title: "Architecture", name: "architecture.md", path: "docs/architecture.md" }),
    candidate({ title: "Guide", name: "guide.md", path: "docs/guide.md" }),
    candidate({ title: "API Notes", name: "api.md", path: "notes/api.md" }),
  ];

  test("empty query lists every candidate sorted by path", () => {
    expect(matchQuickOpenCandidates(notes, "  ").matches.map((item) => item.path)).toEqual([
      "docs/architecture.md",
      "docs/guide.md",
      "notes/api.md",
    ]);
  });

  test("matches title, filename, and path case-insensitively with prefix preference", () => {
    expect(matchQuickOpenCandidates(notes, "GUIDE").matches.map((item) => item.path)).toEqual([
      "docs/guide.md",
    ]);
    expect(matchQuickOpenCandidates(notes, "api.md").matches.map((item) => item.path)).toEqual([
      "notes/api.md",
    ]);
    expect(matchQuickOpenCandidates(notes, "docs/").matches.map((item) => item.path)).toEqual([
      "docs/architecture.md",
      "docs/guide.md",
    ]);
    // Title prefix ranks ahead of a path substring on another note.
    expect(matchQuickOpenCandidates(notes, "api").matches.map((item) => item.path)).toEqual([
      "notes/api.md",
    ]);
  });

  test("caps visible rows while reporting total matches", () => {
    const many = Array.from({ length: MAX_QUICK_OPEN_VISIBLE + 5 }, (_, index) =>
      candidate({
        title: `Note ${index}`,
        name: `note-${index}.md`,
        path: `n/note-${String(index).padStart(3, "0")}.md`,
      }),
    );
    const result = matchQuickOpenCandidates(many, "");
    expect(result.total).toBe(MAX_QUICK_OPEN_VISIBLE + 5);
    expect(result.matches).toHaveLength(MAX_QUICK_OPEN_VISIBLE);
  });
});
