import { readdir } from "node:fs/promises";
import { join, relative, resolve } from "node:path";

import { analyzeMarkdownFile } from "./noteAnalyzer";
import {
  assertCanonicallyContained,
  containedPath,
  isUnsafePathSegment,
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

function isExcludedEntry(name: string, includeHidden: boolean): boolean {
  return (
    PROTECTED_ENTRIES.has(name) ||
    (!includeHidden && name.startsWith(".")) ||
    // Containment refuses these names for every document operation, so listing
    // them offers a document that can only fail to open. Same rule as the
    // symlink skip below: never surface what document I/O cannot reach.
    isUnsafePathSegment(name)
  );
}

function pathLooksHidden(relativePath: string): boolean {
  return relativePath.split(/[/\\]/).some((segment) => segment.startsWith("."));
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
  /** Entries the scan could not read: denied, vanished, or not a directory. */
  skipped: number;
};

/**
 * A folder is a live filesystem, not a snapshot.
 *
 * A subtree can be unreadable (permissions, a stale mount) and a file can be
 * removed by a sync client or a checkout between listing and analysis. Those
 * are ordinary conditions, so they skip that entry instead of failing the whole
 * scan and leaving the person with no folder at all.
 */
function isSkippableScanError(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return (
    code === "EACCES" ||
    code === "EPERM" ||
    code === "ENOENT" ||
    code === "ENOTDIR" ||
    code === "ELOOP" ||
    code === "EMFILE" ||
    code === "ENFILE" ||
    code === "EIO"
  );
}

async function walkForMarkdownPaths(
  directory: string,
  depth: number,
  collection: MarkdownPathCollection,
  includeHidden: boolean,
  beforeReadDirectory?: (directory: string) => void | Promise<void>,
): Promise<void> {
  if (collection.paths.length >= MAX_SCANNED_DOCUMENTS || depth > MAX_SCAN_DEPTH) {
    collection.truncated = true;
    return;
  }

  let entries;
  try {
    // Integration tests inject a skippable fault here. Windows mode bits do
    // not reproduce POSIX EACCES, and `readdir` is bound at module load so a
    // spy cannot reach this catch.
    await beforeReadDirectory?.(directory);
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (!isSkippableScanError(error)) {
      throw error;
    }
    collection.skipped += 1;
    return;
  }

  for (const entry of entries) {
    if (isExcludedEntry(entry.name, includeHidden)) {
      continue;
    }

    const entryPath = join(directory, entry.name);

    // Dirent directory/file checks do not follow POSIX symlinks, but Windows
    // junctions often report as directories. Skip every reparse/symlink entry so
    // scan never walks outside the opened folder. Document I/O still resolves
    // through `assertCanonicallyContained`.
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (entry.isDirectory()) {
      await walkForMarkdownPaths(
        entryPath,
        depth + 1,
        collection,
        includeHidden,
        beforeReadDirectory,
      );
      if (collection.paths.length >= MAX_SCANNED_DOCUMENTS) {
        collection.truncated = true;
        return;
      }
      continue;
    }

    if (!entry.isFile() || !isMarkdownFile(entry.name)) {
      continue;
    }

    if (collection.paths.length >= MAX_SCANNED_DOCUMENTS) {
      collection.truncated = true;
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

/**
 * The scan plus whether the folder was larger than a single scan may hold, so
 * the renderer can say so instead of silently showing a partial folder.
 */
export async function scanWorkspace(
  rootPath: string,
  options: ScanOptions = {},
  testFaults?: {
    beforeReadDirectory?: (directory: string) => void | Promise<void>;
    beforeAnalyzeFile?: (filePath: string) => void | Promise<void>;
  },
): Promise<{ scannedNotes: ScannedNote[]; truncated: boolean; skipped: number }> {
  const linkMode = options.linkMode ?? "markdown";
  const collected: MarkdownPathCollection = { paths: [], truncated: false, skipped: 0 };
  await walkForMarkdownPaths(
    rootPath,
    0,
    collected,
    Boolean(options.includeHidden),
    testFaults?.beforeReadDirectory,
  );
  collected.paths.sort(compareDocumentPaths);
  const scannedNotes: ScannedNote[] = [];
  let skipped = collected.skipped;

  for (const entryPath of collected.paths) {
    try {
      await testFaults?.beforeAnalyzeFile?.(entryPath);
      scannedNotes.push(await scannedNoteFromFile(rootPath, entryPath, linkMode));
    } catch (error) {
      if (!isSkippableScanError(error)) {
        throw error;
      }
      // Listed a moment ago, gone or unreadable now. The rest of the folder is
      // still worth opening.
      skipped += 1;
    }
  }

  return { scannedNotes, truncated: collected.truncated, skipped };
}

/** List the supported filesystem entries directly under a workspace folder. */
export async function listWorkspaceEntries(
  rootPath: string,
  relativePath = "",
  options: ScanOptions = {},
): Promise<FileSystemEntry[]> {
  const includeHidden = Boolean(options.includeHidden);
  // The containment decision is canonical, not a string prefix: a symlinked
  // directory inside the folder must not be able to list what lives outside it.
  const directoryPath = normalizeWorkspaceRelativePath(relativePath);
  const target = containedPath(rootPath, directoryPath);
  await assertCanonicallyContained(rootPath, directoryPath);
  const entries = await readdir(target, { withFileTypes: true });
  const result: FileSystemEntry[] = [];

  for (const entry of entries) {
    if (isExcludedEntry(entry.name, includeHidden)) {
      continue;
    }

    // Same junction/symlink rule as the scan walk: never surface linked
    // directories or files as Explorer entries.
    if (entry.isSymbolicLink()) {
      continue;
    }

    if (!entry.isDirectory() && (!entry.isFile() || !isMarkdownFile(entry.name))) {
      continue;
    }

    const entryRelative = directoryPath ? join(directoryPath, entry.name) : entry.name;
    const path = entryRelative.replace(/\\/g, "/");
    result.push({
      kind: entry.isDirectory() ? "directory" : "file",
      name: entry.name,
      path,
      hidden: pathLooksHidden(path),
    });
  }

  return result.sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "directory" ? -1 : 1;
    }
    return compareDocumentPaths(a.name, b.name);
  });
}
