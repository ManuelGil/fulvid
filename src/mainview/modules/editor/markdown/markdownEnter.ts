import type { MarkdownFence } from "./markdownStructure";

/**
 * Fulvid-owned Enter decisions for Markdown/MDX lists, quotes, fences, and
 * pipe tables.
 *
 * Monaco's language configuration can indent, but it cannot continue list
 * markers, increment ordered lists, exit empty prefixes, close fences, or
 * continue GFM table rows. Tables stay ordinary Markdown text.
 */

/**
 * `insert` places text and moves the caret. `clear-line` removes an empty
 * list or quote prefix and leaves the caret at column 1.
 */
export type MarkdownEnterAction =
  | {
      kind: "insert";
      text: string;
      cursorLineDelta: number;
      cursorColumn: number;
    }
  | {
      kind: "clear-line";
      cursorColumn: 1;
    };

const FENCE_LINE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const OPENING_FENCE_RE = /^(\s{0,3})(`{3,}|~{3,})\s*[A-Za-z0-9_+#/-]*\s*$/;
const LIST_RE = /^(\s*)([-+*]|\d+[.)])([ \t]+)(?:(\[[ xX]\])([ \t]+))?(.*)$/;
const QUOTE_RE = /^(\s*)(>+)([ \t]*)(.*)$/;
const TABLE_SEPARATOR_CELL = /^\s*:?-{3,}:?\s*$/;

function splitTableCells(line: string): string[] | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("|") || !trimmed.endsWith("|") || trimmed.length < 3) {
    return null;
  }

  const inner = trimmed.slice(1, -1);
  const cells: string[] = [];
  let current = "";
  let escaped = false;
  for (const character of inner) {
    if (escaped) {
      current += character;
      escaped = false;
      continue;
    }
    if (character === "\\") {
      current += character;
      escaped = true;
      continue;
    }
    if (character === "|") {
      cells.push(current);
      current = "";
      continue;
    }
    current += character;
  }
  if (escaped) {
    return null;
  }
  cells.push(current);
  return cells;
}

function isSeparatorRow(cells: readonly string[]): boolean {
  return cells.length > 0 && cells.every((cell) => TABLE_SEPARATOR_CELL.test(cell));
}

function cellsAreEmpty(cells: readonly string[]): boolean {
  return cells.every((cell) => cell.trim() === "");
}

function emptyTableRow(columnCount: number): string {
  return `|${"  |".repeat(columnCount)}`;
}

function separatorTableRow(columnCount: number): string {
  return `|${" --- |".repeat(columnCount)}`;
}

function tableEnterAction(
  line: string,
  after: string,
  previousLine: string | undefined,
  nextLine: string | undefined,
): MarkdownEnterAction | null {
  if (after.trim().length > 0) {
    return null;
  }

  const cells = splitTableCells(line);
  if (!cells) {
    return null;
  }

  const previousCells = previousLine === undefined ? null : splitTableCells(previousLine);
  const nextCells = nextLine === undefined ? null : splitTableCells(nextLine);
  const columnCount = cells.length;

  if (isSeparatorRow(cells)) {
    return {
      kind: "insert",
      text: `\n${emptyTableRow(columnCount)}`,
      cursorLineDelta: 1,
      cursorColumn: 3,
    };
  }

  if (nextCells && isSeparatorRow(nextCells)) {
    return null;
  }

  if (cellsAreEmpty(cells)) {
    if (!previousCells) {
      return null;
    }
    return { kind: "clear-line", cursorColumn: 1 };
  }

  if (!previousCells) {
    return {
      kind: "insert",
      text: `\n${separatorTableRow(columnCount)}\n${emptyTableRow(columnCount)}`,
      cursorLineDelta: 2,
      cursorColumn: 3,
    };
  }

  return {
    kind: "insert",
    text: `\n${emptyTableRow(columnCount)}`,
    cursorLineDelta: 1,
    cursorColumn: 3,
  };
}

function lineIndent(value: string): string {
  return value.match(/^\s*/)?.[0] ?? "";
}

function isInsideFence(fences: readonly MarkdownFence[], lineNumber: number): boolean {
  return fences.some((fence) => lineNumber > fence.startLine && lineNumber < fence.endLine);
}

function isClosedFence(fence: MarkdownFence, lines: readonly string[]): boolean {
  if (fence.endLine <= fence.startLine) {
    return false;
  }
  return FENCE_LINE_RE.test(lines[fence.endLine - 1] ?? "");
}

function nextListMarker(marker: string): string {
  if (!/^\d/.test(marker)) {
    return marker;
  }
  return `${Number.parseInt(marker, 10) + 1}${marker.at(-1) ?? "."}`;
}

export function markdownEnterAction(input: {
  lines: readonly string[];
  lineNumber: number;
  column: number;
  fences: readonly MarkdownFence[];
}): MarkdownEnterAction | null {
  const line = input.lines[input.lineNumber - 1];
  if (line === undefined) {
    return null;
  }

  const before = line.slice(0, input.column - 1);
  const after = line.slice(input.column - 1);
  const indent = lineIndent(before);

  if (isInsideFence(input.fences, input.lineNumber)) {
    return {
      kind: "insert",
      text: `\n${indent}`,
      cursorLineDelta: 1,
      cursorColumn: indent.length + 1,
    };
  }

  const openingFence = before.match(OPENING_FENCE_RE);
  if (openingFence && after.trim().length === 0) {
    const fenceIndent = openingFence[1] ?? "";
    const marker = openingFence[2] ?? "```";
    const existing = input.fences.find((fence) => fence.startLine === input.lineNumber);
    if (existing && isClosedFence(existing, input.lines)) {
      return {
        kind: "insert",
        text: `\n${fenceIndent}`,
        cursorLineDelta: 1,
        cursorColumn: fenceIndent.length + 1,
      };
    }

    return {
      kind: "insert",
      text: `\n${fenceIndent}\n${fenceIndent}${marker}`,
      cursorLineDelta: 1,
      cursorColumn: fenceIndent.length + 1,
    };
  }

  const list = before.match(LIST_RE);
  if (list) {
    const content = list[6] ?? "";
    if (!content.trim() && !after.trim()) {
      return { kind: "clear-line", cursorColumn: 1 };
    }

    const checkbox = list[4] ? `[ ]${list[5] ?? " "}` : "";
    const prefix = `${list[1] ?? ""}${nextListMarker(list[2] ?? "-")}${list[3] ?? " "}${checkbox}`;
    return {
      kind: "insert",
      text: `\n${prefix}`,
      cursorLineDelta: 1,
      cursorColumn: prefix.length + 1,
    };
  }

  const blockquote = before.match(QUOTE_RE);
  if (blockquote) {
    const content = blockquote[4] ?? "";
    if (!content.trim() && !after.trim()) {
      return { kind: "clear-line", cursorColumn: 1 };
    }

    const prefix = `${blockquote[1] ?? ""}${blockquote[2] ?? ">"}${blockquote[3] || " "}`;
    return {
      kind: "insert",
      text: `\n${prefix}`,
      cursorLineDelta: 1,
      cursorColumn: prefix.length + 1,
    };
  }

  return tableEnterAction(
    line,
    after,
    input.lines[input.lineNumber - 2],
    input.lines[input.lineNumber],
  );
}
