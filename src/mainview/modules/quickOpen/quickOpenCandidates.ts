/**
 * Quick Open candidate projection.
 *
 * Source of truth for which documents exist remains the Folder scan owned by
 * `workspaceState` (`workspace.scannedNotes`). Filesystem scan / RPC stays the
 * discovery authority. This module only projects identity fields for matching.
 *
 * Not Search: candidates are document identity, not content hits.
 * Not a second index: refresh/open/close Folder rebuilds `scannedNotes`.
 *
 * Opening still goes through `openOrActivate({ kind: "workspace", ... })` →
 * `selectDocument`. A candidate path is not an authorization grant.
 */

import type { ScannedNote } from "../workspace/filesystem/workspaceTypes";

/** Identity fields Quick Open may match and display. */
export type QuickOpenCandidate = {
  /** Display / match title from scan analysis (frontmatter title or filename stem). */
  title: string;
  /** Filename segment of the folder-relative path. */
  name: string;
  /** Folder-relative path; the open key for `openOrActivate`. */
  path: string;
};

/**
 * Project scanned folder documents into Quick Open candidates.
 *
 * Pass `workspace.value?.scannedNotes ?? []`. Do not pass Search-merged notes
 * (`notesWithOpenBufferContent`) or Graph nodes. Empty when no Folder is open.
 */
export function quickOpenCandidatesFromNotes(
  notes: readonly ScannedNote[],
): readonly QuickOpenCandidate[] {
  return notes.map((note) => ({
    title: note.title,
    name: note.name,
    path: note.path,
  }));
}
