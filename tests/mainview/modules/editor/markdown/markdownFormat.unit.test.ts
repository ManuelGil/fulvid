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
): { text: string; start: number; end: number } {
  const result = formatMarkdown(text, [{ start, end }], action);
  return {
    text: applyTextEdits(text, result.edits),
    start: result.selections[0]?.start ?? start,
    end: result.selections[0]?.end ?? end,
  };
}

// Intent: protect user-visible Markdown edits and multi-cursor undo sets.
describe("markdown formatting", () => {
  test("toggles markers without stealing nested emphasis, including multi-cursor edits", () => {
    expect(apply("hello", 0, 5, "italic").text).toBe("*hello*");
    expect(apply("**hello**", 2, 7, "italic").text).toBe("***hello***");
    expect(apply("***hello***", 3, 8, "italic").text).toBe("**hello**");

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
  });
});
