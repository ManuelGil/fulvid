/**
 * Headings, fences, and closed frontmatter as 1-based line ranges.
 *
 * Used by Outline, folding, Enter, Preview heading ids, and heading rename.
 * Unclosed `---` does not end frontmatter here (unlike Preview, which still
 * renders that body). Anchor slugs strip punctuation and collapse spaces.
 */
export type MarkdownHeading = {
  lineNumber: number;
  depth: number;
  text: string;
  anchor: string;
};

export type MarkdownFence = {
  startLine: number;
  endLine: number;
};

export type MarkdownStructure = {
  headings: MarkdownHeading[];
  fences: MarkdownFence[];
  frontmatterEndLine: number | null;
};

const FENCE_RE = /^\s{0,3}(`{3,}|~{3,})/;

/**
 * Lines that cannot be the last line of a paragraph, and therefore cannot
 * carry a setext underline.
 *
 * A `-` or `=` run only makes a heading when it follows paragraph text. After
 * a list item, a block quote, or indented code it is a thematic break or part
 * of that block instead, and treating it as a heading invented an entry the
 * document does not have.
 */
const NOT_PARAGRAPH_LINE_RE = /^(?: {0,3}(?:[-*+]|\d{1,9}[.)])(?:[ \t]|$)| {0,3}>| {4,}\S)/;

/** GFM table delimiter row (`| --- | :-: |`); marks the rest of the block as table rows. */
const TABLE_DELIMITER_ROW_RE = /^\|?[\s:-]*-[\s:|-]*\|[\s:|-]*$/;

export function headingAnchor(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[`*_~]/g, "")
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-");
}

function frontmatterEnd(lines: string[]): number | null {
  if (lines[0]?.trim() !== "---") {
    return null;
  }
  const closingIndex = lines.findIndex((line, index) => index > 0 && line.trim() === "---");
  return closingIndex >= 0 ? closingIndex : null;
}

function fenceMatches(opening: string, closing: string): boolean {
  const openChar = opening[0];
  const closeChar = closing[0];
  return openChar === closeChar && closing.length >= opening.length;
}

export function parseMarkdownStructure(content: string): MarkdownStructure {
  const lines = content.split(/\r?\n/);
  const frontmatterEndIndex = frontmatterEnd(lines);
  const headings: MarkdownHeading[] = [];
  const fences: MarkdownFence[] = [];
  let fenceStart: { line: number; marker: string } | null = null;
  const firstBodyLine = frontmatterEndIndex === null ? 0 : frontmatterEndIndex + 1;
  // A GFM table runs to the next blank line. Its rows are not paragraph text,
  // so a `---` under the last row is a thematic break, not a setext underline.
  let inTable = false;
  // First line of the paragraph the current line belongs to, so a setext
  // heading is reported at its start rather than at its underline.
  let paragraphStart: number | null = null;

  for (let index = firstBodyLine; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(FENCE_RE);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fenceStart) {
        fenceStart = { line: index + 1, marker };
      } else if (fenceMatches(fenceStart.marker, marker)) {
        fences.push({ startLine: fenceStart.line, endLine: index + 1 });
        fenceStart = null;
      }
      inTable = false;
      paragraphStart = null;
      continue;
    }

    if (fenceStart) {
      continue;
    }

    if (trimmed.length === 0) {
      inTable = false;
      paragraphStart = null;
      continue;
    }
    if (TABLE_DELIMITER_ROW_RE.test(trimmed)) {
      inTable = true;
    }

    const atxMatch = line.match(/^( {0,3})(#{1,6})\s+(.+?)\s*#*\s*$/);
    const isParagraphLine = !inTable && !NOT_PARAGRAPH_LINE_RE.test(line);
    if (paragraphStart === null && isParagraphLine && !atxMatch) {
      paragraphStart = index;
    }

    const setextUnderline = lines[index + 1]?.trim() ?? "";
    const isSetext = isParagraphLine && /^(=+|-+)\s*$/.test(setextUnderline);
    if (!atxMatch && !isSetext) {
      if (!isParagraphLine) {
        paragraphStart = null;
      }
      continue;
    }

    // A setext heading is its whole paragraph, which may span several lines.
    const startIndex = atxMatch ? index : (paragraphStart ?? index);
    const text = atxMatch
      ? atxMatch[3].trim()
      : lines
          .slice(startIndex, index + 1)
          .map((entry) => entry.trim())
          .join(" ");
    headings.push({
      lineNumber: startIndex + 1,
      depth: atxMatch ? atxMatch[2].length : setextUnderline.startsWith("=") ? 1 : 2,
      text,
      anchor: headingAnchor(text),
    });
    paragraphStart = null;
    if (isSetext) {
      // Skip the underline so it cannot start the next paragraph.
      index += 1;
    }
  }

  if (fenceStart) {
    fences.push({ startLine: fenceStart.line, endLine: lines.length });
  }

  return {
    headings,
    fences,
    frontmatterEndLine: frontmatterEndIndex === null ? null : frontmatterEndIndex + 1,
  };
}

export function findMarkdownHeading(content: string, anchor: string): MarkdownHeading | undefined {
  let target: string;
  try {
    target = decodeURIComponent(anchor).toLowerCase();
  } catch {
    target = anchor.toLowerCase();
  }

  return parseMarkdownStructure(content).headings.find(
    (heading) => heading.text.toLowerCase() === target || heading.anchor === target,
  );
}
