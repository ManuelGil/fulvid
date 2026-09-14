/**
 * Apply a document-path rename plan to open buffers and closed folder files.
 *
 * Open dirty buffers: Monaco edit only (user Save persists).
 * Open clean buffers and closed files: edit then existing writeDocument/save.
 * Not a transaction — callers must report partial failure honestly.
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
 * `contentByPath` keys are plan-time paths (including `oldPath`).
 */
export async function applyDocumentPathRenamePlan(input: {
  rootPath: string;
  plan: DocumentPathRenamePlan;
  contentByPath: ReadonlyMap<string, string>;
  linkMode: LinkSyntax;
}): Promise<DocumentPathRenameApplyResult> {
  const { rootPath, plan, contentByPath, linkMode } = input;
  const updatedPaths: string[] = [];
  const failedPaths: string[] = [];
  const notes: ScannedNote[] = [];
  const byDocument = documentPathRenameEditsByDocument(plan);

  for (const [planPath, edits] of byDocument) {
    const livePath = pathAfterDocumentRename(planPath, plan.oldPath, plan.newPath);
    try {
      const buffer = getDocumentBuffer(rootPath, livePath);
      if (buffer) {
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

      let base = contentByPath.get(planPath);
      let mtimeMs: number | undefined;
      if (base === undefined) {
        const snapshot = await readDocument(rootPath, livePath);
        base = snapshot.content;
        mtimeMs = snapshot.mtimeMs;
      }
      const next = applyTextEdits(base, edits);
      const result = await writeDocument(rootPath, livePath, next, mtimeMs, linkMode);
      notes.push(result.note);
      updatedPaths.push(livePath);
    } catch {
      failedPaths.push(livePath);
    }
  }

  return { updatedPaths, failedPaths, notes };
}
