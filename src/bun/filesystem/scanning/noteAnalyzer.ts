import { open, stat } from "node:fs/promises";

import {
  parseDocumentLinks,
  type DocumentLink,
  type LinkSyntax,
} from "../../../mainview/modules/document/links/documentLink";
import {
  decodeDocumentText,
  detectDocumentEncoding,
  trimPartialEncodedText,
} from "../io/documentText";

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

/** Longest UTF-8 encoding, so only the final few bytes can be a partial sequence. */
/** Read a document for analysis, capped so one file cannot exhaust memory. */
async function readForAnalysis(filePath: string): Promise<string> {
  const information = await stat(filePath);
  const handle = await open(filePath, "r");
  try {
    if (information.size <= MAX_ANALYZED_BYTES) {
      const whole = await handle.readFile();
      return decodeDocumentText(whole, detectDocumentEncoding(whole));
    }
    const bytes = new Uint8Array(MAX_ANALYZED_BYTES);
    const { bytesRead } = await handle.read(bytes, 0, MAX_ANALYZED_BYTES, 0);
    const read = bytes.subarray(0, bytesRead);
    const encoding = detectDocumentEncoding(read);
    return decodeDocumentText(trimPartialEncodedText(read, encoding), encoding);
  } finally {
    await handle.close();
  }
}

export async function analyzeMarkdownFile(
  filePath: string,
  linkMode: LinkSyntax = "markdown",
): Promise<ParsedNote> {
  // Decoding drops the BOM, so analysis sees the same first character the editor
  // shows. Left in, it would push the document one character along and
  // frontmatter would stop matching.
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
    words: countWords(body),
    content: raw,
  };
}
