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

// Intent: Quick Open matching is identity-only with prefix preference and a visible cap.
// Candidate projection lives in quickOpenCandidates.unit.test.ts.
describe("quick open match", () => {
  test("ranks title prefix over path substring, normalizes separators, and caps visible rows", () => {
    const notes = [
      candidate({ title: "Architecture", name: "architecture.md", path: "docs/architecture.md" }),
      candidate({ title: "Guide", name: "guide.md", path: "docs/guide.md" }),
      candidate({ title: "API Notes", name: "api.md", path: "notes/api.md" }),
      candidate({ title: "Elsewhere", name: "guide-notes.md", path: "archive/guide-notes.md" }),
    ];

    expect(matchQuickOpenCandidates(notes, "GUIDE").matches.map((item) => item.path)).toEqual([
      "docs/guide.md",
      "archive/guide-notes.md",
    ]);
    expect(matchQuickOpenCandidates(notes, "docs\\guide").matches.map((item) => item.path)).toEqual(
      ["docs/guide.md"],
    );
    expect(matchQuickOpenCandidates(notes, "api").matches.map((item) => item.path)).toEqual([
      "notes/api.md",
    ]);

    const noMatch = matchQuickOpenCandidates(notes, "zzz-missing");
    expect(noMatch.matches).toEqual([]);
    expect(noMatch.total).toBe(0);
    expect(matchQuickOpenCandidates([], "guide")).toEqual({ matches: [], total: 0 });

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
