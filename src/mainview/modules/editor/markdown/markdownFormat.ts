/**
 * Markdown/MDX formatting as TextModel edits.
 *
 * One implementation feeds the toolbar, Application Menu, Monaco context menu,
 * and shortcuts. It never parses or executes MDX.
 */

import type { LinkSyntax } from "../../document/links/documentLink";
import { fenceMatches } from "./markdownStructure";

export type MarkdownFormatAction =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inlineCode"
  | "heading"
  | "blockquote"
  | "codeFence"
  | "horizontalRule"
  | "bulletList"
  | "numberedList"
  | "checklist"
  | "toggleTask"
  | "indent"
  | "outdent"
  | "link"
  | "image";

type OffsetRange = {
  start: number;
  end: number;
};

type TextEdit = OffsetRange & {
  text: string;
};

type MarkdownFormatOptions = {
  linkMode?: LinkSyntax;
};

/** One selection's edit, with the new selection relative to the edit's start. */
type FormattedSelection = { edit: TextEdit; selectStart: number; selectEnd: number };

type MarkdownFormatResult = {
  edits: TextEdit[];
  selections: OffsetRange[];
};

export const MARKDOWN_COMMANDS = [
  { action: "bold", id: "markdownBold", shortcut: "Ctrl/Cmd+B" },
  { action: "italic", id: "markdownItalic", shortcut: "Ctrl/Cmd+I" },
  { action: "strikethrough", id: "markdownStrikethrough" },
  { action: "inlineCode", id: "markdownInlineCode", shortcut: "Ctrl/Cmd+E" },
  { action: "heading", id: "markdownHeading" },
  { action: "blockquote", id: "markdownBlockquote" },
  { action: "codeFence", id: "markdownCodeFence" },
  { action: "horizontalRule", id: "markdownHorizontalRule" },
  { action: "bulletList", id: "markdownBulletList" },
  { action: "numberedList", id: "markdownNumberedList" },
  { action: "checklist", id: "markdownChecklist" },
  { action: "toggleTask", id: "markdownToggleTask" },
  { action: "indent", id: "markdownIndent" },
  { action: "outdent", id: "markdownOutdent" },
  { action: "link", id: "markdownLink", shortcut: "Ctrl/Cmd+K" },
  { action: "image", id: "markdownImage" },
] as const;

export type MarkdownCommandId = (typeof MARKDOWN_COMMANDS)[number]["id"];

const CHECKLIST_RE = /^(\s*)(?:[-*+]\s+\[[ xX]\]\s+)(.*)$/;
const BULLET_RE = /^(\s*)(?:[-*+]\s+)(.*)$/;
const NUMBERED_RE = /^(\s*)(?:\d+\.\s+)(.*)$/;
const HEADING_RE = /^( {0,3})(#{1,6})(?:\s+|$)(.*)$/;
const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;
const URL_RE = /^(?:https?:|mailto:)/i;

export function formatMarkdown(
  text: string,
  selections: readonly OffsetRange[],
  action: MarkdownFormatAction,
  options: MarkdownFormatOptions = {},
): MarkdownFormatResult {
  const normalized = normalizeSelections(text, selections);
  const edits: TextEdit[] = [];
  const formatted: FormattedSelection[] = [];

  for (const selection of normalized) {
    const next = formatOne(text, selection, action, options);
    if (next.edit.start !== next.edit.end || next.edit.text !== "") {
      edits.push(next.edit);
    }
    formatted.push(next);
  }

  return {
    edits,
    selections: formatted.map((next) => {
      const origin = mapOffset(next.edit.start, edits);
      return {
        start: origin + next.selectStart,
        end: origin + next.selectEnd,
      };
    }),
  };
}

export function applyTextEdits(text: string, edits: readonly TextEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start);
  let next = text;
  for (const edit of ordered) {
    next = next.slice(0, edit.start) + edit.text + next.slice(edit.end);
  }
  return next;
}

export function offsetToPosition(
  text: string,
  offset: number,
): { lineNumber: number; column: number } {
  const clamped = Math.max(0, Math.min(offset, text.length));
  let lineNumber = 1;
  let lineStart = 0;
  for (let index = 0; index < clamped; index += 1) {
    if (text[index] === "\n") {
      lineNumber += 1;
      lineStart = index + 1;
    }
  }
  return { lineNumber, column: clamped - lineStart + 1 };
}

function normalizeSelections(text: string, selections: readonly OffsetRange[]): OffsetRange[] {
  const fallback = { start: 0, end: 0 };
  const source = selections.length > 0 ? selections : [fallback];
  const unique = new Map<string, OffsetRange>();
  for (const selection of source) {
    const start = clamp(Math.min(selection.start, selection.end), 0, text.length);
    const end = clamp(Math.max(selection.start, selection.end), 0, text.length);
    unique.set(`${start}:${end}`, { start, end });
  }
  return [...unique.values()].sort((left, right) => left.start - right.start);
}

function formatOne(
  text: string,
  selection: OffsetRange,
  action: MarkdownFormatAction,
  options: MarkdownFormatOptions,
): FormattedSelection {
  switch (action) {
    case "bold":
      return wrapInline(text, selection, "**", false);
    case "italic":
      return wrapInline(text, selection, "*", true);
    case "strikethrough":
      return wrapInline(text, selection, "~~", false);
    case "inlineCode":
      return wrapInline(text, selection, "`", false);
    case "heading":
      return transformLines(text, selection, cycleHeadings);
    case "blockquote":
      return transformLines(text, selection, toggleBlockquotes);
    case "codeFence":
      return wrapFence(text, selection);
    case "horizontalRule":
      return insertHorizontalRule(text, selection);
    case "bulletList":
      return transformLines(text, selection, (lines) => toggleList(lines, "bullet"));
    case "numberedList":
      return transformLines(text, selection, (lines) => toggleList(lines, "numbered"));
    case "checklist":
      return transformLines(text, selection, (lines) => toggleList(lines, "checklist"));
    case "toggleTask":
      return transformLines(text, selection, toggleTaskCheckboxes);
    case "indent":
      return transformLines(text, selection, (lines) => lines.map((line) => `  ${line}`));
    case "outdent":
      return transformLines(text, selection, (lines) => lines.map(outdentLine));
    case "link":
    case "image":
      return insertReference(text, selection, action, options.linkMode ?? "markdown");
  }
}

function wrapInline(
  text: string,
  selection: OffsetRange,
  marker: string,
  italic: boolean,
): FormattedSelection {
  const selected = text.slice(selection.start, selection.end);
  if (
    selected.startsWith(marker) &&
    selected.endsWith(marker) &&
    selected.length >= marker.length * 2
  ) {
    if (!italic || marker !== "*" || !selected.startsWith("**") || selected.length === 2) {
      const inner = selected.slice(marker.length, selected.length - marker.length);
      return makeTextReplacement(selection.start, selection.end, inner, 0, inner.length);
    }
  }

  if (isWrappedBy(text, selection.start, selection.end, marker, italic)) {
    return makeTextReplacement(
      selection.start - marker.length,
      selection.end + marker.length,
      selected,
      0,
      selected.length,
    );
  }

  const wrapped = `${marker}${selected}${marker}`;
  return makeTextReplacement(
    selection.start,
    selection.end,
    wrapped,
    marker.length,
    marker.length + selected.length,
  );
}

function isWrappedBy(
  text: string,
  start: number,
  end: number,
  marker: string,
  italic: boolean,
): boolean {
  const before = text.slice(start - marker.length, start);
  const after = text.slice(end, end + marker.length);
  if (before !== marker || after !== marker) {
    return false;
  }
  if (!italic || marker !== "*") {
    return true;
  }
  const boldWrapped = text.slice(start - 2, start) === "**" && text.slice(end, end + 2) === "**";
  const tripleWrapped =
    text.slice(start - 3, start) === "***" && text.slice(end, end + 3) === "***";
  return tripleWrapped || !boldWrapped;
}

/** The whole lines a selection touches; a selection ending on a newline stops before it. */
function selectedLineBlock(text: string, selection: OffsetRange): OffsetRange {
  const exclusiveEnd =
    selection.end > selection.start && text[selection.end - 1] === "\n"
      ? selection.end - 1
      : selection.end;
  return { start: lineStartOffset(text, selection.start), end: lineEndOffset(text, exclusiveEnd) };
}

function transformLines(
  text: string,
  selection: OffsetRange,
  transform: (lines: string[]) => string[],
): FormattedSelection {
  const { start: blockStart, end: blockEnd } = selectedLineBlock(text, selection);
  const block = text.slice(blockStart, blockEnd);
  const next = transform(block.split("\n")).join("\n");
  return makeTextReplacement(blockStart, blockEnd, next, 0, next.length);
}

function cycleHeadings(lines: string[]): string[] {
  return lines.map((line) => {
    const match = line.match(HEADING_RE);
    if (!match) {
      const indent = line.match(/^(\s*)/)?.[1] ?? "";
      return `${indent}# ${line.slice(indent.length)}`;
    }
    const indent = match[1] ?? "";
    const level = match[2]?.length ?? 1;
    const rest = match[3] ?? "";
    if (level >= 6) {
      return `${indent}${rest}`;
    }
    return `${indent}${"#".repeat(level + 1)} ${rest}`;
  });
}

function toggleBlockquotes(lines: string[]): string[] {
  const quoted = lines.every((line) => /^ {0,3}>/.test(line));
  return lines.map((line) =>
    quoted ? line.replace(/^ {0,3}>\s?/, "") : /^ {0,3}>/.test(line) ? line : `> ${line}`,
  );
}

function toggleList(lines: string[], kind: "bullet" | "numbered" | "checklist"): string[] {
  const already = lines.every((line) => listKind(line) === kind || line.trim() === "");
  return lines.map((line, index) => {
    if (line.trim() === "") {
      return line;
    }
    const parsed = parseListLine(line);
    if (already) {
      return `${parsed.indent}${parsed.body}`;
    }
    const prefix = kind === "numbered" ? `${index + 1}. ` : kind === "checklist" ? "- [ ] " : "- ";
    return `${parsed.indent}${prefix}${parsed.body}`;
  });
}

/**
 * Flip `[ ]` / `[x]` / `[X]` on existing task list lines only.
 * Non-task lines stay unchanged. Each task line toggles independently, so a
 * mixed selection becomes the inverse of each marker.
 */
function toggleTaskCheckboxes(lines: string[]): string[] {
  return lines.map((line) => {
    const match = line.match(/^(\s*[-*+]\s+)\[([ xX])\](\s+.*)$/);
    if (!match) {
      return line;
    }
    const marker = match[2] === " " ? "x" : " ";
    return `${match[1]}[${marker}]${match[3]}`;
  });
}

function listKind(line: string): "bullet" | "numbered" | "checklist" | null {
  if (CHECKLIST_RE.test(line)) {
    return "checklist";
  }
  if (NUMBERED_RE.test(line)) {
    return "numbered";
  }
  if (BULLET_RE.test(line)) {
    return "bullet";
  }
  return null;
}

function parseListLine(line: string): { indent: string; body: string } {
  for (const pattern of [CHECKLIST_RE, NUMBERED_RE, BULLET_RE]) {
    const match = line.match(pattern);
    if (match) {
      return { indent: match[1] ?? "", body: match[2] ?? "" };
    }
  }
  const indent = line.match(/^(\s*)/)?.[1] ?? "";
  return { indent, body: line.slice(indent.length) };
}

function outdentLine(line: string): string {
  if (line.startsWith("\t")) {
    return line.slice(1);
  }
  if (line.startsWith("  ")) {
    return line.slice(2);
  }
  if (line.startsWith(" ")) {
    return line.slice(1);
  }
  return line;
}

function wrapFence(text: string, selection: OffsetRange): FormattedSelection {
  const { start: blockStart, end: blockEnd } = selectedLineBlock(text, selection);
  const block = text.slice(blockStart, blockEnd);
  const lines = block.split("\n");
  const first = lines[0] ?? "";
  const last = lines[lines.length - 1] ?? "";
  const open = first.match(FENCE_RE)?.[1];
  const close = last.match(FENCE_RE)?.[1];
  if (lines.length >= 2 && open && close && fenceMatches(open, close)) {
    const inner = lines.slice(1, -1).join("\n");
    return makeTextReplacement(blockStart, blockEnd, inner, 0, inner.length);
  }
  const next = `\`\`\`\n${block}\n\`\`\``;
  return makeTextReplacement(blockStart, blockEnd, next, 4, 4 + block.length);
}

function insertHorizontalRule(text: string, selection: OffsetRange): FormattedSelection {
  const currentStart = lineStartOffset(text, selection.start);
  const currentEnd = lineEndOffset(text, selection.start);
  const line = text.slice(currentStart, currentEnd);
  if (line.trim() === "") {
    return makeTextReplacement(currentStart, currentEnd, "---", 3, 3);
  }
  const suffix = text[currentEnd] === "\n" ? "---\n" : "\n---\n";
  return makeTextReplacement(currentEnd, currentEnd, suffix, suffix.length, suffix.length);
}

function insertReference(
  text: string,
  selection: OffsetRange,
  action: "link" | "image",
  linkMode: LinkSyntax,
): FormattedSelection {
  const selected = text.slice(selection.start, selection.end);
  if (linkMode === "wikilink") {
    const wrapped = action === "image" ? `![[${selected}]]` : `[[${selected}]]`;
    const inner = action === "image" ? 3 : 2;
    return makeTextReplacement(
      selection.start,
      selection.end,
      wrapped,
      inner,
      selected ? inner + selected.length : inner,
    );
  }

  const asUrl = URL_RE.test(selected);
  if (action === "image") {
    if (asUrl) {
      return makeTextReplacement(selection.start, selection.end, `![](${selected})`, 2, 2);
    }
    const wrapped = `![${selected}]()`;
    const urlStart = 3 + selected.length + 2;
    return makeTextReplacement(selection.start, selection.end, wrapped, urlStart, urlStart);
  }
  if (asUrl) {
    return makeTextReplacement(selection.start, selection.end, `[](${selected})`, 1, 1);
  }
  const wrapped = `[${selected}]()`;
  const urlStart = 1 + selected.length + 2;
  return makeTextReplacement(selection.start, selection.end, wrapped, urlStart, urlStart);
}

function makeTextReplacement(
  start: number,
  end: number,
  text: string,
  selectStart: number,
  selectEnd: number,
): FormattedSelection {
  return {
    edit: { start, end, text },
    selectStart,
    selectEnd,
  };
}

function mapOffset(offset: number, edits: readonly TextEdit[]): number {
  let next = offset;
  for (const edit of edits) {
    if (edit.start < offset) {
      next += edit.text.length - (edit.end - edit.start);
    }
  }
  return next;
}

function lineStartOffset(text: string, offset: number): number {
  const index = text.lastIndexOf("\n", Math.max(0, offset - 1));
  return index === -1 ? 0 : index + 1;
}

function lineEndOffset(text: string, offset: number): number {
  const index = text.indexOf("\n", offset);
  return index === -1 ? text.length : index;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
