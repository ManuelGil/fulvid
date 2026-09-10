/**
 * Heading and fragment references as DocumentLink semantics.
 *
 * Find References and semantic Rename operate on these ranges. They are not
 * Search, and they never rename a file or rewrite unrelated text.
 */

import {
  parseDocumentLinks,
  resolveDocumentLink,
  type DocumentLink,
  type LinkSyntax,
} from "../../document/links/documentLink";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import {
  findMarkdownHeading,
  headingAnchor,
  parseMarkdownStructure,
  type MarkdownHeading,
} from "./markdownStructure";

export type TextRange = {
  start: number;
  end: number;
};

export type HeadingReference = {
  kind: "heading" | "fragment";
  documentPath: string | null;
  range: TextRange;
  link?: DocumentLink;
};

export type HeadingSemanticEntity =
  | { kind: "heading"; heading: MarkdownHeading; range: TextRange }
  | { kind: "fragment"; heading: MarkdownHeading; range: TextRange; link: DocumentLink };

export type HeadingRenameEdit = {
  documentPath: string | null;
  start: number;
  end: number;
  text: string;
};

export type HeadingRenamePlan = {
  oldName: string;
  newName: string;
  nextAnchor: string;
  headingDocumentPath: string | null;
  edits: HeadingRenameEdit[];
};

function lineStartOffset(content: string, lineNumber: number): number {
  let line = 1;
  let offset = 0;
  while (line < lineNumber && offset <= content.length) {
    const newline = content.indexOf("\n", offset);
    if (newline < 0) {
      return content.length;
    }
    offset = newline + 1;
    line += 1;
  }
  return offset;
}

function lineContent(content: string, lineNumber: number): string {
  const start = lineStartOffset(content, lineNumber);
  const newline = content.indexOf("\n", start);
  const raw = newline < 0 ? content.slice(start) : content.slice(start, newline);
  return raw.endsWith("\r") ? raw.slice(0, -1) : raw;
}

export function headingTextRange(content: string, heading: MarkdownHeading): TextRange | null {
  const start = lineStartOffset(content, heading.lineNumber);
  const line = lineContent(content, heading.lineNumber);
  const atx = line.match(/^( {0,3}#{1,6}\s+)(.*?)(\s*#*\s*)$/);
  if (atx) {
    const inner = atx[2] ?? "";
    const trimmed = inner.trim();
    if (!trimmed) {
      return null;
    }
    const leading = inner.length - inner.trimStart().length;
    const textStart = start + (atx[1] ?? "").length + leading;
    return { start: textStart, end: textStart + trimmed.length };
  }

  const trimmed = line.trim();
  if (!trimmed) {
    return null;
  }
  const leading = line.length - line.trimStart().length;
  const textStart = start + leading;
  return { start: textStart, end: textStart + trimmed.length };
}

function headingAtLine(content: string, lineNumber: number): MarkdownHeading | null {
  const headings = parseMarkdownStructure(content).headings;
  const onLine = headings.find((heading) => heading.lineNumber === lineNumber);
  if (onLine) {
    return onLine;
  }
  const line = lineContent(content, lineNumber).trim();
  if (!/^(=+|-+)$/.test(line)) {
    return null;
  }
  return headings.find((heading) => heading.lineNumber === lineNumber - 1) ?? null;
}

function markdownDestination(raw: string): { destStart: number; dest: string } | null {
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

export function fragmentAnchorRange(link: DocumentLink): TextRange | null {
  if (!link.anchor) {
    return null;
  }
  if (link.syntax === "markdown") {
    const destination = markdownDestination(link.raw);
    if (!destination) {
      return null;
    }
    const hash = destination.dest.indexOf("#");
    if (hash < 0) {
      return null;
    }
    const after = destination.dest.slice(hash + 1);
    const boundary = after.search(/[\s)]/);
    const length = boundary < 0 ? after.length : boundary;
    const start = link.range.start + destination.destStart + hash + 1;
    return { start, end: start + length };
  }

  const inner = link.raw.startsWith("[[")
    ? link.raw.slice(2, link.raw.endsWith("]]") ? -2 : undefined)
    : link.raw;
  const hash = inner.indexOf("#");
  if (hash < 0) {
    return null;
  }
  const after = inner.slice(hash + 1);
  const pipe = after.indexOf("|");
  const length = pipe < 0 ? after.length : pipe;
  const innerStart = link.raw.startsWith("[[") ? link.range.start + 2 : link.range.start;
  const start = innerStart + hash + 1;
  return { start, end: start + length };
}

export function linkPartAtOffset(
  link: DocumentLink,
  offset: number,
): "label" | "document-target" | "fragment-target" | "other" {
  if (offset < link.range.start || offset > link.range.end) {
    return "other";
  }
  const local = offset - link.range.start;
  if (link.syntax === "markdown") {
    const closeLabel = link.raw.indexOf("](");
    if (closeLabel < 0) {
      return "other";
    }
    if (local > 0 && local <= closeLabel) {
      return "label";
    }
    const destination = markdownDestination(link.raw);
    if (!destination) {
      return "other";
    }
    const destEnd = destination.destStart + destination.dest.length;
    if (local < destination.destStart || local > destEnd + 1) {
      return "other";
    }
    const hash = destination.dest.indexOf("#");
    if (hash >= 0 && local >= destination.destStart + hash) {
      return "fragment-target";
    }
    return "document-target";
  }

  if (!link.raw.startsWith("[[")) {
    return "other";
  }
  const innerOffset = local - 2;
  if (innerOffset < 0 || local > link.raw.length - 2) {
    return "other";
  }
  const inner = link.raw.slice(2, -2);
  const pipe = inner.indexOf("|");
  if (pipe >= 0 && innerOffset > pipe) {
    return "label";
  }
  const hash = inner.indexOf("#");
  if (hash >= 0 && innerOffset >= hash && (pipe < 0 || innerOffset < pipe)) {
    return "fragment-target";
  }
  return inner.trim() ? "document-target" : "other";
}

function anchorsMatch(heading: MarkdownHeading, anchor: string): boolean {
  let target: string;
  try {
    target = decodeURIComponent(anchor).toLowerCase();
  } catch {
    target = anchor.toLowerCase();
  }
  return heading.anchor === target || heading.text.toLowerCase() === target;
}

function headingAnchorIsUnique(content: string, heading: MarkdownHeading): boolean {
  return (
    parseMarkdownStructure(content).headings.filter(
      (candidate) => candidate.anchor === heading.anchor,
    ).length === 1
  );
}

function linkResolvesToHeadingDocument(
  link: DocumentLink,
  headingDocumentPath: string | null,
  sourcePath: string | null,
  notes: ScannedNote[],
): boolean {
  const resolved = resolveDocumentLink(link, notes, undefined, sourcePath ?? undefined);
  if (resolved.path) {
    return headingDocumentPath !== null && resolved.path === headingDocumentPath;
  }
  return !link.target && sourcePath === headingDocumentPath;
}

/**
 * What F2 / Find References bind to at this offset: a heading title or a
 * same-document fragment target. File names and link labels are out of scope.
 */
export function semanticEntityAt(
  content: string,
  offset: number,
  linkMode: LinkSyntax,
  notes: ScannedNote[] = [],
  sourcePath: string | null = null,
): HeadingSemanticEntity | null {
  const link = parseDocumentLinks(content, linkMode).find(
    (candidate) => offset >= candidate.range.start && offset <= candidate.range.end,
  );
  if (link) {
    if (linkPartAtOffset(link, offset) !== "fragment-target" || !link.anchor) {
      return null;
    }
    const resolved = resolveDocumentLink(link, notes, undefined, sourcePath ?? undefined);
    const targetPath = resolved.path ?? (!link.target ? sourcePath : null);
    if (targetPath !== sourcePath) {
      return null;
    }
    const heading = findMarkdownHeading(content, link.anchor);
    const range = heading ? headingTextRange(content, heading) : null;
    if (!heading || !range) {
      return null;
    }
    return { kind: "fragment", heading, range, link };
  }

  const heading = headingAtLine(content, offsetToLine(content, offset));
  const range = heading ? headingTextRange(content, heading) : null;
  if (!heading || !range) {
    return null;
  }
  return { kind: "heading", heading, range };
}

function offsetToLine(content: string, offset: number): number {
  let lineNumber = 1;
  const limit = Math.max(0, Math.min(offset, content.length));
  for (let index = 0; index < limit; index += 1) {
    if (content[index] === "\n") {
      lineNumber += 1;
    }
  }
  return lineNumber;
}

export function headingForFragmentLink(
  link: DocumentLink,
  sourcePath: string | null,
  notes: ScannedNote[],
  documents: readonly { path: string | null; content: string }[],
): { heading: MarkdownHeading; documentPath: string | null } | null {
  if (!link.anchor) {
    return null;
  }
  const resolved = resolveDocumentLink(link, notes, undefined, sourcePath ?? undefined);
  const documentPath = resolved.path ?? (!link.target ? sourcePath : null);
  const document = documents.find((candidate) => candidate.path === documentPath);
  if (!document) {
    return null;
  }
  const heading = findMarkdownHeading(document.content, link.anchor);
  return heading ? { heading, documentPath } : null;
}

/**
 * Heading definition plus fragment links that resolve to it, including closed
 * documents from scan evidence. Find References shows this full set; Rename
 * then filters it to open models.
 */
export function collectHeadingReferences(
  heading: MarkdownHeading,
  headingDocumentPath: string | null,
  documents: readonly { path: string | null; content: string }[],
  notes: ScannedNote[],
  linkMode: LinkSyntax,
): HeadingReference[] {
  const headingDocument = documents.find((document) => document.path === headingDocumentPath);
  const headingRange = headingDocument ? headingTextRange(headingDocument.content, heading) : null;
  const references: HeadingReference[] = [];
  const seen = new Set<string>();

  function add(reference: HeadingReference): void {
    const key = `${reference.documentPath ?? ""}\0${reference.range.start}:${reference.range.end}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    references.push(reference);
  }

  if (headingRange) {
    add({
      kind: "heading",
      documentPath: headingDocumentPath,
      range: headingRange,
    });
  }

  for (const document of documents) {
    for (const link of parseDocumentLinks(document.content, linkMode)) {
      if (!link.anchor || !anchorsMatch(heading, link.anchor)) {
        continue;
      }
      if (!linkResolvesToHeadingDocument(link, headingDocumentPath, document.path, notes)) {
        continue;
      }
      const range = fragmentAnchorRange(link);
      if (!range) {
        continue;
      }
      add({
        kind: "fragment",
        documentPath: document.path,
        range,
        link,
      });
    }
  }

  return references;
}

/**
 * Build Monaco workspace edits for a heading or fragment rename.
 *
 * Only open documents are rewritten. Closed-file references can appear in
 * Find References; they are not mutated. This never renames a file. Duplicate
 * heading anchors skip fragment rewrites so a non-unique slug cannot retarget
 * the wrong heading.
 */
export function planHeadingRename(
  heading: MarkdownHeading,
  headingDocumentPath: string | null,
  headingContent: string,
  newName: string,
  references: readonly HeadingReference[],
  openDocumentPaths: ReadonlySet<string | null>,
): HeadingRenamePlan | null {
  const nextName = newName.trim();
  if (!nextName || nextName.includes("\n") || nextName.includes("\r")) {
    return null;
  }

  const headingRange = headingTextRange(headingContent, heading);
  if (!headingRange) {
    return null;
  }

  const nextAnchor = headingAnchor(nextName);
  const unique = headingAnchorIsUnique(headingContent, heading);
  const edits: HeadingRenameEdit[] = [];

  if (openDocumentPaths.has(headingDocumentPath) && nextName !== heading.text) {
    edits.push({
      documentPath: headingDocumentPath,
      start: headingRange.start,
      end: headingRange.end,
      text: nextName,
    });
  }

  if (unique) {
    for (const reference of references) {
      if (reference.kind !== "fragment" || !openDocumentPaths.has(reference.documentPath)) {
        continue;
      }
      if (
        reference.range.start === headingRange.start &&
        reference.documentPath === headingDocumentPath
      ) {
        continue;
      }
      edits.push({
        documentPath: reference.documentPath,
        start: reference.range.start,
        end: reference.range.end,
        text: nextAnchor,
      });
    }
  }

  if (edits.length === 0) {
    return null;
  }

  return {
    oldName: heading.text,
    newName: nextName,
    nextAnchor,
    headingDocumentPath,
    edits,
  };
}
