/**
 * Whether a folder scan found documents Fulvid can edit.
 *
 * This is not authorization. It reads scan evidence the filesystem owner
 * already produced: Markdown and MDX names, plus whether the walk finished.
 * A partial scan with zero notes is not "no documents".
 */
import {
  documentFileType,
  type WorkspaceScan,
} from "../modules/workspace/filesystem/workspaceTypes";

export type FolderDocumentPreflight = {
  markdown: number;
  mdx: number;
  total: number;
  complete: boolean;
};

export function folderDocumentPreflight(
  scan: Pick<WorkspaceScan, "scannedNotes" | "truncated" | "skipped">,
): FolderDocumentPreflight {
  let markdown = 0;
  let mdx = 0;

  for (const note of scan.scannedNotes) {
    if (documentFileType(note.path) === "mdx") {
      mdx += 1;
    } else {
      markdown += 1;
    }
  }

  return {
    markdown,
    mdx,
    total: markdown + mdx,
    complete: !scan.truncated && (scan.skipped ?? 0) === 0,
  };
}

/** Load when documents were found, or when the scan cannot honestly say there are none. */
export function shouldLoadFolderWorkspace(preflight: FolderDocumentPreflight): boolean {
  return preflight.total > 0 || !preflight.complete;
}
