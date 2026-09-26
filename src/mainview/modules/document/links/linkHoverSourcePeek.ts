/**
 * Short Markdown-source peek for document-link hover.
 *
 * Uses the same target text already loaded for hover/heading checks
 * (`contentForPath`). Does not render HTML, call marked, summarize, or
 * invent text. Distinct from PreviewPane / `renderMarkdownPreview`.
 */

/** How much of the target we may scan to build the peek (large-file ceiling). */
export const LINK_HOVER_PEEK_READ_CAP = 4_096;

/** Soft visual cap: a few lines in the hover tooltip. */
export const LINK_HOVER_PEEK_MAX_LINES = 5;

/** Soft visual cap: short enough that path + honesty stay primary. */
export const LINK_HOVER_PEEK_MAX_CHARS = 220;

const CLOSED_FRONTMATTER_RE = /^---\r?\n[\s\S]*?\r?\n---\r?\n?/;

export type LinkHoverSourcePeekOptions = {
  /** 1-based heading line when the link targets a fragment. */
  startLineNumber?: number;
};

function offsetOfLine(content: string, lineNumber1Based: number): number {
  if (lineNumber1Based <= 1) {
    return 0;
  }
  let line = 1;
  for (let index = 0; index < content.length; index += 1) {
    if (content.charCodeAt(index) === 0x0a) {
      line += 1;
      if (line === lineNumber1Based) {
        return index + 1;
      }
    }
  }
  return content.length;
}

/** Start of body after a closed YAML frontmatter block; else 0. */
export function markdownBodyStartOffset(content: string): number {
  const match = CLOSED_FRONTMATTER_RE.exec(content);
  return match ? match[0].length : 0;
}

/**
 * Fence source so Monaco hover Markdown cannot turn it into links/HTML.
 * Lengthens the fence if the excerpt already contains the same backtick run.
 */
export function linkHoverPeekAsHoverMarkdown(peek: string): string {
  let fence = "```";
  while (peek.includes(fence)) {
    fence += "`";
  }
  return `${fence}markdown\n${peek}\n${fence}`;
}

/**
 * Compact hover body: identity, path only when it adds information, optional
 * honesty lines, then a secondary source peek in one Markdown block.
 */
export function linkHoverContentsMarkdown(parts: {
  title: string;
  path?: string | null;
  detailLines?: readonly string[];
  peek?: string | null;
}): string {
  const lines: string[] = [`**${parts.title}**`];
  if (parts.path && parts.path !== parts.title) {
    lines.push(parts.path);
  }
  for (const detail of parts.detailLines ?? []) {
    if (detail) {
      lines.push(detail);
    }
  }
  const header = lines.join("\n");
  if (!parts.peek) {
    return header;
  }
  return `${header}\n\n${linkHoverPeekAsHoverMarkdown(parts.peek)}`;
}

/**
 * Small excerpt of Markdown source from `content`, or null when there is
 * nothing useful to show (empty / frontmatter-only).
 */
export function linkHoverSourcePeek(
  content: string,
  options: LinkHoverSourcePeekOptions = {},
): string | null {
  if (!content) {
    return null;
  }

  const bodyOffset = markdownBodyStartOffset(content);
  const headingOffset =
    options.startLineNumber !== undefined
      ? offsetOfLine(content, options.startLineNumber)
      : bodyOffset;
  const startOffset = Math.max(bodyOffset, headingOffset);
  if (startOffset >= content.length) {
    return null;
  }

  const window = content.slice(startOffset, startOffset + LINK_HOVER_PEEK_READ_CAP);
  const truncatedByReadCap = startOffset + LINK_HOVER_PEEK_READ_CAP < content.length;
  const lines = window.split(/\r?\n/);

  let firstContent = 0;
  while (firstContent < lines.length && lines[firstContent]?.trim() === "") {
    firstContent += 1;
  }
  if (firstContent >= lines.length) {
    return null;
  }

  const taken: string[] = [];
  let chars = 0;
  let truncated = truncatedByReadCap;
  for (let index = firstContent; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (taken.length >= LINK_HOVER_PEEK_MAX_LINES) {
      truncated = true;
      break;
    }
    const newlineCost = taken.length > 0 ? 1 : 0;
    const remaining = LINK_HOVER_PEEK_MAX_CHARS - chars - newlineCost;
    if (remaining <= 0) {
      truncated = true;
      break;
    }
    if (line.length > remaining) {
      taken.push(`${line.slice(0, remaining)}...`);
      truncated = true;
      break;
    }
    taken.push(line);
    chars += line.length + newlineCost;
  }

  if (taken.length === 0) {
    return null;
  }

  // Drop trailing blank lines so the fence does not look padded.
  while (taken.length > 0 && taken[taken.length - 1]?.trim() === "") {
    taken.pop();
  }
  if (taken.length === 0) {
    return null;
  }

  let peek = taken.join("\n");
  if (truncated && !peek.endsWith("...")) {
    peek = `${peek}\n...`;
  }
  return peek;
}
