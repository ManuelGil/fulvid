import { describe, expect, test } from "bun:test";

import {
  collectTrailingWhitespaceSpans,
  trailingWhitespaceOnLine,
  trimTrailingWhitespaceInText,
} from "../../../../src/mainview/modules/editor/trailingWhitespace.ts";

// Intent: trailing trim is spaces/tabs at line end only — not EOL, not indent.
describe("trailing whitespace", () => {
  test("detects spaces and tabs, including empty lines that are only whitespace", () => {
    expect(trailingWhitespaceOnLine("hello  ")).toEqual({ startColumn: 6, endColumn: 8 });
    expect(trailingWhitespaceOnLine("hello\t\t")).toEqual({ startColumn: 6, endColumn: 8 });
    expect(trailingWhitespaceOnLine("  ")).toEqual({ startColumn: 1, endColumn: 3 });
    expect(trailingWhitespaceOnLine("hello")).toBeNull();
    expect(trailingWhitespaceOnLine("")).toBeNull();
    expect(trailingWhitespaceOnLine("  hello")).toBeNull();
  });

  test("collects spans across a document and preserves LF/CRLF when trimming text", () => {
    const lines = ["a  ", "b", "   ", "c\t"];
    expect(
      collectTrailingWhitespaceSpans(lines.length, (lineNumber) => lines[lineNumber - 1]!),
    ).toEqual([
      { lineNumber: 1, startColumn: 2, endColumn: 4 },
      { lineNumber: 3, startColumn: 1, endColumn: 4 },
      { lineNumber: 4, startColumn: 2, endColumn: 3 },
    ]);

    expect(trimTrailingWhitespaceInText("a  \nb\n   \nc\t\n")).toBe("a\nb\n\nc\n");
    expect(trimTrailingWhitespaceInText("a  \r\nb\r\n")).toBe("a\r\nb\r\n");
    expect(trimTrailingWhitespaceInText("solo  ")).toBe("solo");
    expect(trimTrailingWhitespaceInText("clean\n")).toBe("clean\n");
  });
});
