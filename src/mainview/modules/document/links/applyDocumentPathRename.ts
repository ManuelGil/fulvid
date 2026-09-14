/**
 * Apply a document-path rename plan to open buffers and closed folder files.
 *
 * Open dirty buffers: Monaco edit only (user Save persists).
 * Open clean buffers and closed files: edit then existing writeDocument/save.
 * Not a transaction — callers must report partial failure honestly.
 *
 * Closed-file bases always come from a fresh disk read (mtime conflict check).
 * Every edit requires the planned `previous` span to still match, so await gaps
 * and stale scan caches cannot silently corrupt or overwrite newer text.
 */
import {
  getDocumentBuffer,
  isDocumentDirty,
  saveDocument,
  type DocumentBuffer,
} from "../../editor/document/documentBuffers";
import { applyTextEdits, offsetToPosition } from "../../editor/markdown/markdownFormat";
import { initializeMonaco } from "../../editor/monaco/monacoSetup";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import { readDocument, writeDocument } from "../../workspace/filesystem/workspaceScanner";
import type { LinkSyntax } from "./documentLink";
import {
  documentPathRenameEditsByDocument,
  pathAfterDocumentRename,
  type DocumentPathRenameEdit,
  type DocumentPathRenamePlan,
} from "./documentPathRename";

export type DocumentPathRenameApplyResult = {
  updatedPaths: string[];
  failedPaths: string[];
  /** Re-analyzed notes from successful disk writes (not dirty open buffers). */
  notes: ScannedNote[];
};

function editsStillMatch(content: string, edits: readonly DocumentPathRenameEdit[]): boolean {
  return edits.every((edit) => content.slice(edit.start, edit.end) === edit.previous);
}

function applyEditsToBuffer(
  buffer: DocumentBuffer,
  edits: readonly DocumentPathRenameEdit[],
): void {
  const api = initializeMonaco();
  const text = buffer.model.getValue();
  const monacoEdits = [...edits]
    .sort((left, right) => right.start - left.start)
    .map((edit) => {
      const start = offsetToPosition(text, edit.start);
      const end = offsetToPosition(text, edit.end);
      return {
        range: new api.Range(start.lineNumber, start.column, end.lineNumber, end.column),
        text: edit.text,
      };
    });
  buffer.model.pushEditOperations(null, monacoEdits, () => null);
}

/**
 * Apply planned edits after the filesystem rename and buffer reidentification.
 * Plan edits are keyed by plan-time paths (including `oldPath`).
 */
export async function applyDocumentPathRenamePlan(input: {
  rootPath: string;
  plan: DocumentPathRenamePlan;
  linkMode: LinkSyntax;
}): Promise<DocumentPathRenameApplyResult> {
  const { rootPath, plan, linkMode } = input;
  const updatedPaths: string[] = [];
  const failedPaths: string[] = [];
  const notes: ScannedNote[] = [];
  const byDocument = documentPathRenameEditsByDocument(plan);

  for (const [planPath, edits] of byDocument) {
    const livePath = pathAfterDocumentRename(planPath, plan.oldPath, plan.newPath);
    try {
      const buffer = getDocumentBuffer(rootPath, livePath);
      if (buffer) {
        const liveText = buffer.model.getValue();
        if (!editsStillMatch(liveText, edits)) {
          failedPaths.push(livePath);
          continue;
        }
        const wasDirty = isDocumentDirty(buffer);
        applyEditsToBuffer(buffer, edits);
        if (!wasDirty) {
          const result = await saveDocument(buffer);
          if ("note" in result) {
            notes.push(result.note);
          }
        }
        updatedPaths.push(livePath);
        continue;
      }

      // Closed file: never trust scan-cached content for the write base.
      const snapshot = await readDocument(rootPath, livePath);
      if (!editsStillMatch(snapshot.content, edits)) {
        failedPaths.push(livePath);
        continue;
      }
      const next = applyTextEdits(snapshot.content, edits);
      const result = await writeDocument(rootPath, livePath, next, snapshot.mtimeMs, linkMode);
      notes.push(result.note);
      updatedPaths.push(livePath);
    } catch {
      failedPaths.push(livePath);
    }
  }

  return { updatedPaths, failedPaths, notes };
}
