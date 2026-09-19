import type { FileSystemEntry } from "../filesystem/workspaceTypes";

/**
 * Explorer list-session helpers.
 *
 * Explorer is a lazy filesystem projection (`listDirectory`), not a second
 * note index. Overlapping list/refresh calls must not apply stale results
 * after reset, workspace switch, or a newer load of the same path.
 */

/** Parent of a workspace-relative path (`""` for root children). */
export function explorerParentPath(path: string): string {
  const segments = path.split("/").filter(Boolean);
  segments.pop();
  return segments.join("/");
}

export function isCurrentExplorerListSession(
  requestSession: number,
  currentSession: number,
  requestRoot: string | null,
  currentRoot: string | null,
): boolean {
  return requestSession === currentSession && requestRoot !== null && requestRoot === currentRoot;
}

/**
 * After a directory listing succeeds, drop expansion/cache for children that
 * disappeared from that listing so refresh cannot leave dead expanded rows.
 */
export function reconcileExplorerDirectoryState(
  relativePath: string,
  listed: readonly FileSystemEntry[],
  entriesByDirectory: Record<string, FileSystemEntry[]>,
  expandedDirectories: ReadonlySet<string>,
): {
  entriesByDirectory: Record<string, FileSystemEntry[]>;
  expandedDirectories: Set<string>;
} {
  const nextEntries: Record<string, FileSystemEntry[]> = {
    ...entriesByDirectory,
    [relativePath]: [...listed],
  };
  const listedChildDirectories = new Set(
    listed.filter((entry) => entry.kind === "directory").map((entry) => entry.path),
  );

  const removedPrefixes: string[] = [];
  for (const path of expandedDirectories) {
    if (explorerParentPath(path) === relativePath && !listedChildDirectories.has(path)) {
      removedPrefixes.push(path);
    }
  }

  const nextExpanded = new Set(expandedDirectories);
  for (const prefix of removedPrefixes) {
    for (const path of [...nextExpanded]) {
      if (path === prefix || path.startsWith(`${prefix}/`)) {
        nextExpanded.delete(path);
      }
    }
    for (const key of Object.keys(nextEntries)) {
      if (key === prefix || key.startsWith(`${prefix}/`)) {
        delete nextEntries[key];
      }
    }
  }

  return { entriesByDirectory: nextEntries, expandedDirectories: nextExpanded };
}
