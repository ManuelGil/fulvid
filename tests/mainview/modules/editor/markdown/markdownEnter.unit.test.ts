import { describe, expect, test } from "bun:test";

import { markdownEnterAction } from "../../../../../src/mainview/modules/editor/markdown/markdownEnter.ts";
import { parseMarkdownStructure } from "../../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";

function enter(content: string, lineNumber: number, column: number) {
  const lines = content.split("\n");
  return markdownEnterAction({
    lines,
    lineNumber,
    column,
    fences: parseMarkdownStructure(content).fences,
  });
}

function enterAtEnd(content: string, lineNumber: number) {
  const line = content.split("\n")[lineNumber - 1] ?? "";
  return enter(content, lineNumber, line.length + 1);
}

// Intent: Fulvid's Markdown Enter contract for lists, fences, and tables.
describe("Markdown Enter", () => {
  test("continues lists, fences, and tables; clears empty prefixes", () => {
    expect(enter("- item", 1, 7)).toEqual({
      kind: "insert",
      text: "\n- ",
      cursorLineDelta: 1,
      cursorColumn: 3,
    });
    expect(enter("1. item", 1, 8)).toEqual({
      kind: "insert",
      text: "\n2. ",
      cursorLineDelta: 1,
      cursorColumn: 4,
    });
    expect(enter("- [x] done", 1, 11)).toEqual({
      kind: "insert",
      text: "\n- [ ] ",
      cursorLineDelta: 1,
      cursorColumn: 7,
    });
    expect(enter("> quote", 1, 8)).toEqual({
      kind: "insert",
      text: "\n> ",
      cursorLineDelta: 1,
      cursorColumn: 3,
    });
    expect(enter("- ", 1, 3)).toEqual({ kind: "clear-line", cursorColumn: 1 });

    expect(enter("```ts", 1, 6)).toEqual({
      kind: "insert",
      text: "\n\n```",
      cursorLineDelta: 1,
      cursorColumn: 1,
    });
    expect(enter("```ts\n  const value = 1\n```", 2, 19)).toEqual({
      kind: "insert",
      text: "\n  ",
      cursorLineDelta: 1,
      cursorColumn: 3,
    });

    const table = ["| Name | Value |", "| --- | --- |", "| Foo | Bar |"].join("\n");
    expect(enterAtEnd(table, 2)).toEqual({
      kind: "insert",
      text: "\n|  |  |",
      cursorLineDelta: 1,
      cursorColumn: 3,
    });
    expect(enterAtEnd("| Header 1 | Header 2 |", 1)).toEqual({
      kind: "insert",
      text: "\n| --- | --- |\n|  |  |",
      cursorLineDelta: 2,
      cursorColumn: 3,
    });
    expect(enterAtEnd("| A", 1)).toBeNull();
  });
});
