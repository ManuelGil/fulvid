import { describe, expect, test } from "bun:test";

import {
  applyTextEdits,
  formatMarkdown,
} from "../../../../../src/mainview/modules/editor/markdown/markdownFormat.ts";

function apply(
  text: string,
  start: number,
  end: number,
  action: Parameters<typeof formatMarkdown>[2],
  options?: Parameters<typeof formatMarkdown>[3],
): { text: string; start: number; end: number } {
  const result = formatMarkdown(text, [{ start, end }], action, options);
  return {
    text: applyTextEdits(text, result.edits),
    start: result.selections[0]?.start ?? start,
    end: result.selections[0]?.end ?? end,
  };
}

// Intent: protect user-visible Markdown edits and selection mapping.
// Growth boundary: add cases only for new actions, nesting rules, or cursor invariants.
describe("markdown formatting", () => {
  test("toggles italic without stealing bold markers", () => {
    const italic = apply("hello", 0, 5, "italic");
    expect(italic.text).toBe("*hello*");

    const bold = apply("**hello**", 2, 7, "italic");
    expect(bold.text).toBe("***hello***");

    const unwrapItalic = apply("***hello***", 3, 8, "italic");
    expect(unwrapItalic.text).toBe("**hello**");

    const wrapped = apply("hello", 0, 5, "bold");
    expect(wrapped.text).toBe("**hello**");
    expect(apply(wrapped.text, wrapped.start, wrapped.end, "bold").text).toBe("hello");
  });

  test("formats multiple cursors as one undoable edit set", () => {
    const text = "one two";
    const result = formatMarkdown(
      text,
      [
        { start: 0, end: 3 },
        { start: 4, end: 7 },
      ],
      "bold",
    );
    expect(applyTextEdits(text, result.edits)).toBe("**one** **two**");
    expect(result.edits).toHaveLength(2);
    expect(result.selections).toEqual([
      { start: 2, end: 5 },
      { start: 10, end: 13 },
    ]);
  });
});
