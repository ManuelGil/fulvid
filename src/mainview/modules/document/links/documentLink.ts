import {
  getDocumentLinkSettings,
  resolveDocumentPath,
  type DocumentResolutionReason,
} from "./linkSemantics";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";

/**
 * Shared DocumentLink parse and resolve boundary.
 *
 * Syntax is configured as markdown XOR wikilink. Consumers (scan, Preview,
 * Monaco, Graph) must not parse links independently.
 */

export type LinkSyntax = "wikilink" | "markdown";

/**
 * Explicit document-to-document reference in the active link syntax.
 *
 * Ranges are source offsets so Monaco, Preview, Graph, and scan share one
 * parse. This is not a Markdown AST node and does not represent images or
 * external URLs.
 */
export interface DocumentLink {
  syntax: LinkSyntax;
  raw: string;
  target: string;
  anchor?: string;
  label?: string;
  range: {
    start: number;
    end: number;
  };
}

export interface LinkResolution {
  link: DocumentLink;
  path: string | null;
  reason: DocumentResolutionReason;
  /** See {@link resolveDocumentPath} `alsoMatches`. */
  alsoMatches: string[];
}

const EXTERNAL_TARGET_RE = /^(?:[a-z][a-z\d+.-]*:|\/\/)/i;
const WIKILINK_RE = /\[\[([^\]|#]*?)(?:#([^\]|]+?))?(?:\|([^\]]+?))?\]\]/g;
const MARKDOWN_LINK_RE =
  /(?<!!)\[([^\]]*)\]\(\s*(<[^>\n]+>|[^)\s]+)(?:\s+(?:"[^"\n]*"|'[^'\n]*'|\([^)\n]*\)))?\s*\)/g;

function cleanTarget(rawTarget: string): string {
  const target = rawTarget.trim();
  if (target.startsWith("<") && target.endsWith(">")) {
    return target.slice(1, -1).trim();
  }
  return target;
}

function isDocumentTarget(target: string): boolean {
  return Boolean(target) && !target.startsWith("#") && !EXTERNAL_TARGET_RE.test(target);
}

function createWikilink(match: RegExpExecArray): DocumentLink | null {
  const raw = match[0];
  const target = match[1].trim();
  const link: DocumentLink = {
    syntax: "wikilink",
    raw,
    target,
    range: {
      start: match.index,
      end: match.index + raw.length,
    },
  };
  const anchor = match[2]?.trim();
  const label = match[3]?.trim();
  if (!target && !anchor) {
    return null;
  }
  if (target && !isDocumentTarget(target)) {
    return null;
  }
  if (anchor) {
    link.anchor = anchor;
  }
  if (label) {
    link.label = label;
  }
  return link;
}

function createMarkdownLink(match: RegExpExecArray): DocumentLink | null {
  const raw = match[0];
  const target = cleanTarget(match[2]);
  const hashIndex = target.indexOf("#");
  const targetPath = hashIndex === -1 ? target : target.slice(0, hashIndex);
  const anchor = hashIndex === -1 ? "" : target.slice(hashIndex + 1).trim();
  if (targetPath && !isDocumentTarget(targetPath)) {
    return null;
  }
  if (!targetPath && !anchor) {
    return null;
  }

  const link: DocumentLink = {
    syntax: "markdown",
    raw,
    target: targetPath,
    range: {
      start: match.index,
      end: match.index + raw.length,
    },
  };
  if (anchor) {
    link.anchor = anchor;
  }
  const label = match[1]?.trim();
  if (label) {
    link.label = label;
  }
  return link;
}

type IgnoredRange = { start: number; end: number };

function isFenceMatch(opening: string, closing: string): boolean {
  return opening[0] === closing[0] && closing.length >= opening.length;
}

function ignoredMarkdownRanges(text: string): IgnoredRange[] {
  const ranges: IgnoredRange[] = [];
  const frontmatter = text.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  const frontmatterEnd = frontmatter?.[0].length ?? 0;
  if (frontmatterEnd > 0) {
    ranges.push({ start: 0, end: frontmatterEnd });
  }

  let fenceStart: { offset: number; marker: string } | null = null;
  let offset = frontmatterEnd;
  while (offset < text.length) {
    const newline = text.indexOf("\n", offset);
    const lineEnd = newline < 0 ? text.length : newline + 1;
    const line = text.slice(offset, lineEnd);
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^(`{3,}|~{3,})/);

    if (fenceMatch) {
      const marker = fenceMatch[1];
      if (!fenceStart) {
        fenceStart = { offset, marker };
      } else if (isFenceMatch(fenceStart.marker, marker)) {
        ranges.push({ start: fenceStart.offset, end: lineEnd });
        fenceStart = null;
      }
    } else if (!fenceStart) {
      let codeStart: { offset: number; length: number } | null = null;
      for (let index = 0; index < line.length;) {
        if (line[index] !== "`") {
          index += 1;
          continue;
        }
        let end = index;
        while (line[end] === "`") {
          end += 1;
        }
        const length = end - index;
        if (!codeStart) {
          codeStart = { offset: offset + index, length };
        } else if (codeStart.length === length) {
          ranges.push({
            start: codeStart.offset,
            end: offset + end,
          });
          codeStart = null;
        }
        index = end;
      }
      if (codeStart) {
        ranges.push({ start: codeStart.offset, end: lineEnd });
      }
    }

    offset = lineEnd;
  }

  if (fenceStart) {
    ranges.push({ start: fenceStart.offset, end: text.length });
  }
  return ranges;
}

function isIgnoredLink(link: DocumentLink, ignoredRanges: IgnoredRange[]): boolean {
  return ignoredRanges.some(
    (range) => range.start <= link.range.start && link.range.end <= range.end,
  );
}

/**
 * Parse explicit document links for the active syntax only.
 *
 * Markdown mode and Wikilink mode are mutually exclusive. Fenced code, inline
 * code, and closed frontmatter are ignored so Preview, Graph, and Monaco
 * markers share one parse. This is not a Markdown AST.
 */
export function parseDocumentLinks(text: string, linkMode: LinkSyntax): DocumentLink[] {
  const links: DocumentLink[] = [];
  const ignoredRanges = ignoredMarkdownRanges(text);
  const pattern = linkMode === "wikilink" ? WIKILINK_RE : MARKDOWN_LINK_RE;
  const createLink = linkMode === "wikilink" ? createWikilink : createMarkdownLink;

  pattern.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const link = createLink(match);
    if (link && !isIgnoredLink(link, ignoredRanges)) {
      links.push(link);
    }
  }

  return links.sort((left, right) => left.range.start - right.range.start);
}

/**
 * The destination of a Markdown link's source text: what sits between `](`
 * and the final `)`, with its offset inside `raw`. Null for anything else.
 */
export function markdownDestination(raw: string): { destStart: number; dest: string } | null {
  const closeLabel = raw.indexOf("](");
  if (closeLabel < 0) {
    return null;
  }
  const destStart = closeLabel + 2;
  const destEnd = raw.lastIndexOf(")");
  if (destEnd <= destStart) {
    return null;
  }
  return { destStart, dest: raw.slice(destStart, destEnd) };
}

/**
 * Resolve a parsed link against scan evidence.
 *
 * Returns a workspace-relative note path or null. Does not open a buffer,
 * touch disk, or invent a second resolver.
 */
export function resolveDocumentLink(
  link: DocumentLink,
  notes: ScannedNote[],
  resolution = getDocumentLinkSettings().resolution,
  sourcePath?: string,
): LinkResolution {
  const resolved = resolveDocumentPath(link.target, notes, resolution, sourcePath);
  return {
    link,
    path: resolved.path,
    reason: resolved.reason,
    alsoMatches: resolved.alsoMatches,
  };
}
