/**
 * Create a seeded Markdown/MDX file inside the open folder and open it.
 *
 * Shared by Explorer and File → New from README when a folder is open.
 * Filename identity stays with the caller (prompt); this only writes and opens.
 */
import { applyScannedNote } from "../../../app/workspaceState";
import type { LinkSyntax } from "../../document/links/documentLink";
import { createDocument } from "../../workspace/filesystem/workspaceScanner";
import { openOrActivate } from "./documentBuffers";

export type SeededWorkspaceDocumentInput = {
  rootPath: string;
  /** Folder-relative parent; empty string = workspace root. */
  parentRelativePath: string;
  fileName: string;
  content: string;
  linkMode: LinkSyntax;
};

/** Write the seeded file, merge it into the scan, and activate the tab. */
export async function createAndOpenSeededWorkspaceDocument(
  input: SeededWorkspaceDocumentInput,
): Promise<string> {
  const relativePath = [input.parentRelativePath, input.fileName].filter(Boolean).join("/");
  const result = await createDocument(input.rootPath, relativePath, input.content, input.linkMode);
  applyScannedNote(result.note);
  await openOrActivate({
    kind: "workspace",
    rootPath: input.rootPath,
    path: relativePath,
  });
  return relativePath;
}
