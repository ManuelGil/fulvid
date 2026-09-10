import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { analyzeMarkdownFile } from "./noteAnalyzer";
import {
  assertCanonicallyContained,
  containedPath,
  normalizeWorkspaceRelativePath,
} from "../security/workspacePaths";

import { isMarkdownFile } from "../../../mainview/modules/workspace/filesystem/workspaceTypes";
import type {
  FileSystemEntry,
  ScannedNote,
} from "../../../mainview/modules/workspace/filesystem/workspaceTypes";
import type { LinkSyntax } from "../../../mainview/modules/document/links/documentLink";

/** Always excluded - never documentation evidence. */
const PROTECTED_ENTRIES = new Set([".git", ".svn", ".hg", "node_modules"]);

function isProtectedEntry(name: string): boolean {
  return PROTECTED_ENTRIES.has(name);
}

function isHiddenName(name: string): boolean {
  return name.startsWith(".");
}

function isExcludedEntry(name: string, includeHidden: boolean): boolean {
  if (isProtectedEntry(name)) {
    return true;
  }

  if (!includeHidden && isHiddenName(name)) {
    return true;
  }

  return false;
}

/**
 * Resolve an Explorer directory request against the folder root.
 *
 * The containment decision is canonical, not a string prefix: a symlinked
 * directory inside the folder must not be able to list what lives outside it.
 */
async function workspaceDirectory(
  rootPath: string,
  relativePath: string,
): Promise<{ path: string; relativePath: string }> {
  const normalizedPath = normalizeWorkspaceRelativePath(relativePath);
  const target = containedPath(rootPath, normalizedPath);
  await assertCanonicallyContained(rootPath, normalizedPath);
  return { path: target, relativePath: normalizedPath };
}

export function pathLooksHidden(relativePath: string): boolean {
  return relativePath.split(/[/\\]/).some((segment) => segment.length > 0 && isHiddenName(segment));
}

/**
 * Folder-relative ScannedNote for a file already proven to be inside `rootPath`.
 * Shared by scan and document write/rename so Explorer and Context see the same shape.
 */
export async function scannedNoteFromFile(
  rootPath: string,
  absolutePath: string,
  linkMode: LinkSyntax,
): Promise<ScannedNote> {
  const path = relative(resolve(rootPath), resolve(absolutePath)).replace(/\\/g, "/");
  return {
    path,
    name: path.split("/").pop() ?? path,
    hidden: pathLooksHidden(path),
    ...(await analyzeMarkdownFile(absolutePath, linkMode)),
  };
}

export type ScanOptions = {
  includeHidden?: boolean;
  linkMode?: LinkSyntax;
};

/**
 * Ceilings for a single folder scan. They exist so that pointing Fulvid at a
 * home directory or a filesystem root degrades into a partial, usable folder
 * instead of an unbounded walk that exhausts renderer memory.
 */
export const MAX_SCANNED_DOCUMENTS = 5_000;
const MAX_SCAN_DEPTH = 24;

type MarkdownPathCollection = {
  paths: string[];
  truncated: boolean;
};

function scanLimitReached(collection: MarkdownPathCollection): boolean {
  return collection.paths.length >= MAX_SCANNED_DOCUMENTS;
}

function markScanTruncated(collection: MarkdownPathCollection): void {
  collection.truncated = true;
}

async function walkForMarkdownPaths(
  directory: string,
  depth: number,
  collection: MarkdownPathCollection,
  includeHidden: boolean,
): Promise<void> {
  if (scanLimitReached(collection) || depth > MAX_SCAN_DEPTH) {
    markScanTruncated(collection);
    return;
  }

  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries) {
    if (isExcludedEntry(entry.name, includeHidden)) {
      continue;
    }

    const entryPath = join(directory, entry.name);

    // Dirent file/directory checks do not follow symlinks. Linked notes are
    // invisible to scan/list; document I/O still resolves them through
    // `assertCanonicallyContained` so a link cannot escape the folder.
    if (entry.isDirectory()) {
      await walkForMarkdownPaths(entryPath, depth + 1, collection, includeHidden);
      if (scanLimitReached(collection)) {
        markScanTruncated(collection);
        return;
      }
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(entry.name)) {
      continue;
    }

    if (scanLimitReached(collection)) {
      markScanTruncated(collection);
      return;
    }
    collection.paths.push(entryPath);
  }
}

function compareDocumentPaths(pathA: string, pathB: string): number {
  return (
    pathA.localeCompare(pathB, undefined, { sensitivity: "base" }) || pathA.localeCompare(pathB)
  );
}

async function collectMarkdownPaths(
  rootPath: string,
  includeHidden: boolean,
): Promise<MarkdownPathCollection> {
  const collection: MarkdownPathCollection = { paths: [], truncated: false };

  await walkForMarkdownPaths(rootPath, 0, collection, includeHidden);
  collection.paths.sort(compareDocumentPaths);
  return collection;
}

/**
 * The scan plus whether the folder was larger than a single scan may hold, so
 * the renderer can say so instead of silently showing a partial folder.
 */
export async function scanWorkspace(
  rootPath: string,
  options: ScanOptions = {},
): Promise<{ scannedNotes: ScannedNote[]; truncated: boolean }> {
  const includeHidden = Boolean(options.includeHidden);
  const linkMode = options.linkMode ?? "markdown";
  const { paths: filePaths, truncated } = await collectMarkdownPaths(rootPath, includeHidden);
  const scannedNotes: ScannedNote[] = [];

  for (const entryPath of filePaths) {
    scannedNotes.push(await scannedNoteFromFile(rootPath, entryPath, linkMode));
  }

  return { scannedNotes, truncated };
}

/** List the supported filesystem entries directly under a workspace folder. */
export async function listWorkspaceEntries(
  rootPath: string,
  relativePath = "",
  options: ScanOptions = {},
): Promise<FileSystemEntry[]> {
  const includeHidden = Boolean(options.includeHidden);
  const target = await workspaceDirectory(rootPath, relativePath);
  const entries = await readdir(target.path, { withFileTypes: true });
  const result: FileSystemEntry[] = [];

  for (const entry of entries) {
    if (isExcludedEntry(entry.name, includeHidden)) {
      continue;
    }

    if (!entry.isDirectory() && (!entry.isFile() || !isMarkdownFile(entry.name))) {
      continue;
    }

    const entryRelative = target.relativePath ? join(target.relativePath, entry.name) : entry.name;
    const normalized = entryRelative.replace(/\\/g, "/");
    result.push({
      kind: entry.isDirectory() ? "directory" : "file",
      name: entry.name,
      path: normalized,
      hidden: pathLooksHidden(normalized),
    });
  }

  return result.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return compareDocumentPaths(a.name, b.name);
  });
}
