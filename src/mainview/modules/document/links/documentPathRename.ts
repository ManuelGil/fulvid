/**
 * Deterministic document-path reference continuity for filesystem rename/move.
 *
 * Reuses DocumentLink parse + resolveDocumentLink. Not a refactoring engine:
 * it only rewrites link targets that already resolve to the renamed path.
 * Heading rename stays in headingReferences; this never changes fragments or labels.
 */
import { relativeDocumentLinkPath } from "../../editor/markdown/markdownAuthoring";
import {
  markdownDestination,
  parseDocumentLinks,
  resolveDocumentLink,
  type DocumentLink,
  type LinkSyntax,
} from "./documentLink";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";

export type TextRange = {
  start: number;
  end: number;
};

export type DocumentPathRenameEdit = {
  /** Folder-relative path at plan time (still `oldPath` for the renamed note). */
  documentPath: string;
  start: number;
  end: number;
  /** Exact path span text at plan time - apply must still see this or abort. */
  previous: string;
  /** Replacement for the document-target span only (no `#fragment`). */
  text: string;
};

export type DocumentPathRenamePlan = {
  oldPath: string;
  newPath: string;
  edits: DocumentPathRenameEdit[];
};

/**
 * Source span of the document path inside a link, excluding `#fragment` and
 * wikilink `|label`. Null when the link has no document target (fragment-only).
 */
export function documentTargetRange(link: DocumentLink): TextRange | null {
  if (!link.target) {
    return null;
  }

  if (link.syntax === "markdown") {
    const destination = markdownDestination(link.raw);
    if (!destination) {
      return null;
    }
    const hash = destination.dest.indexOf("#");
    const pathPart = hash < 0 ? destination.dest : destination.dest.slice(0, hash);
    const angle = pathPart.startsWith("<") && pathPart.endsWith(">");
    const inner = angle ? pathPart.slice(1, -1) : pathPart;
    const leading = inner.length - inner.trimStart().length;
    const trimmed = inner.trim();
    if (!trimmed) {
      return null;
    }
    const start = link.range.start + destination.destStart + (angle ? 1 : 0) + leading;
    return { start, end: start + trimmed.length };
  }

  if (!link.raw.startsWith("[[")) {
    return null;
  }
  const inner = link.raw.slice(2, link.raw.endsWith("]]") ? -2 : undefined);
  const pipe = inner.indexOf("|");
  const beforeLabel = pipe < 0 ? inner : inner.slice(0, pipe);
  const hash = beforeLabel.indexOf("#");
  const pathPart = hash < 0 ? beforeLabel : beforeLabel.slice(0, hash);
  const leading = pathPart.length - pathPart.trimStart().length;
  const trimmed = pathPart.trim();
  if (!trimmed) {
    return null;
  }
  const start = link.range.start + 2 + leading;
  return { start, end: start + trimmed.length };
}

/**
 * Build offset edits that retarget inbound (and self) links from `oldPath` to
 * `newPath` using source-relative path semantics.
 *
 * Call before the filesystem rename while `notes` still contain `oldPath`.
 * Prefer live buffer text via `contentByPath` when a referrer is open.
 */
export function planDocumentPathRename(input: {
  oldPath: string;
  newPath: string;
  notes: readonly ScannedNote[];
  linkMode: LinkSyntax;
  contentByPath?: ReadonlyMap<string, string>;
}): DocumentPathRenamePlan {
  const { oldPath, newPath, notes, linkMode, contentByPath } = input;
  const edits: DocumentPathRenameEdit[] = [];

  if (!oldPath || !newPath || oldPath === newPath) {
    return { oldPath, newPath, edits };
  }

  const noteList = notes as ScannedNote[];

  for (const note of notes) {
    const content = contentByPath?.get(note.path) ?? note.content ?? "";
    const links = parseDocumentLinks(content, linkMode);
    const sourceForRelative = note.path === oldPath ? newPath : note.path;

    for (const link of links) {
      if (!link.target) {
        continue;
      }
      const resolved = resolveDocumentLink(link, noteList, undefined, note.path);
      if (resolved.path !== oldPath) {
        continue;
      }
      const range = documentTargetRange(link);
      if (!range) {
        continue;
      }
      const nextTarget = relativeDocumentLinkPath(sourceForRelative, newPath);
      const current = content.slice(range.start, range.end);
      if (current === nextTarget) {
        continue;
      }
      edits.push({
        documentPath: note.path,
        start: range.start,
        end: range.end,
        previous: current,
        text: nextTarget,
      });
    }
  }

  return { oldPath, newPath, edits };
}

/** Group plan edits by plan-time document path. */
export function documentPathRenameEditsByDocument(
  plan: DocumentPathRenamePlan,
): Map<string, DocumentPathRenameEdit[]> {
  const byPath = new Map<string, DocumentPathRenameEdit[]>();
  for (const edit of plan.edits) {
    const list = byPath.get(edit.documentPath) ?? [];
    list.push(edit);
    byPath.set(edit.documentPath, list);
  }
  return byPath;
}

/** Map a plan-time path to the post-rename folder-relative path. */
export function pathAfterDocumentRename(
  documentPath: string,
  oldPath: string,
  newPath: string,
): string {
  return documentPath === oldPath ? newPath : documentPath;
}
