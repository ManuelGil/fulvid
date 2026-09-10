import { open, stat } from "node:fs/promises";

import {
  parseDocumentLinks,
  type DocumentLink,
  type LinkSyntax,
} from "../../../mainview/modules/document/links/documentLink";

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

/**
 * How much of one document a folder scan will hold in memory.
 *
 * Far above any hand-written Markdown file; the point is that a single
 * oversized file degrades to a partial analysis instead of exhausting the
 * renderer, which receives this content for search.
 */
export const MAX_ANALYZED_BYTES = 2 * 1024 * 1024;

interface ParsedNote {
  title: string;
  aliases: string[];
  documentLinks: DocumentLink[];
  tags: string[];
  categories: string[];
  projects: string[];
  summary: string;
  tokens: number;
  words: number;
  content: string;
}

function noteTitleFromFilename(filename: string): string {
  return filename.replace(/\.(md|markdown|mdx)$/i, "");
}

function parseFrontmatterValue(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }

  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^['"]|['"]$/g, ""))
      .filter(Boolean);
  }

  return [trimmed.replace(/^['"]|['"]$/g, "")];
}

function parseFrontmatter(frontmatter: string): Record<string, string[]> {
  const fields: Record<string, string[]> = {};

  for (const line of frontmatter.split("\n")) {
    const match = line.match(/^([A-Za-z0-9_-]+)\s*:\s*(.*)$/);
    if (!match) {
      continue;
    }

    const key = match[1].toLowerCase();
    fields[key] = parseFrontmatterValue(match[2]);
  }

  return fields;
}

function countWords(text: string): number {
  const trimmed = text.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

function countTokens(text: string): number {
  return Math.ceil(countWords(text) * 1.3);
}

/** Drop a trailing partial UTF-8 sequence left by a byte-level cut. */
function trimPartialUtf8(bytes: Uint8Array): Uint8Array {
  for (let index = bytes.length - 1; index >= 0 && index > bytes.length - 5; index -= 1) {
    const byte = bytes[index];
    if ((byte & 0b1100_0000) === 0b1000_0000) {
      continue;
    }
    // A lead byte: keep its sequence only when all of it was read.
    const expected = byte < 0x80 ? 1 : byte >= 0xf0 ? 4 : byte >= 0xe0 ? 3 : byte >= 0xc0 ? 2 : 1;
    return bytes.length - index >= expected ? bytes : bytes.subarray(0, index);
  }
  return bytes;
}

/** Read a document for analysis, capped so one file cannot exhaust memory. */
async function readForAnalysis(filePath: string): Promise<string> {
  const information = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    if (information.size <= MAX_ANALYZED_BYTES) {
      return await handle.readFile({ encoding: "utf8" });
    }
    const bytes = new Uint8Array(MAX_ANALYZED_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, MAX_ANALYZED_BYTES, 0);
    return new TextDecoder("utf-8").decode(trimPartialUtf8(bytes.subarray(0, bytesRead)));
  } finally {
    await handle.close();
  }
}

export async function analyzeMarkdownFile(
  filePath: string,
  linkMode: LinkSyntax = "markdown",
): Promise<ParsedNote> {
  const raw = await readForAnalysis(filePath);
  const frontmatterMatch = raw.match(FRONTMATTER_RE);
  const body = frontmatterMatch ? raw.slice(frontmatterMatch[0].length) : raw;
  const bodyOffset = frontmatterMatch?.[0].length ?? 0;
  const documentLinks = parseDocumentLinks(body, linkMode).map((link) => ({
    ...link,
    range: {
      start: link.range.start + bodyOffset,
      end: link.range.end + bodyOffset,
    },
  }));
  const fields = frontmatterMatch ? parseFrontmatter(frontmatterMatch[1]) : {};

  const aliases = fields.aliases ?? fields.alias ?? [];
  const tags = fields.tags ?? fields.tag ?? [];
  const categories = fields.categories ?? fields.category ?? [];
  const projects = fields.projects ?? fields.project ?? [];
  const explicitTitle = fields.title?.[0]?.trim();
  const summary = fields.summary?.[0]?.trim() ?? "";

  return {
    title: explicitTitle || noteTitleFromFilename(filePath.split(/[/\\]/).pop() ?? ""),
    aliases,
    documentLinks,
    tags,
    categories,
    projects,
    summary,
    tokens: countTokens(body),
    words: countWords(body),
    content: raw,
  };
}
