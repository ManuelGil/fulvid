/**
 * Production editor capability contract (Extension API v1).
 *
 * Explicit guest surface (requires capability `editor` + `lua`):
 *   - editor.getSelection() -> string (frozen primary-selection text snapshot)
 *   - editor.replaceSelection(text) -> queues one replace; applied after Lua returns
 *
 * Protocol:
 *   renderer snapshots selection text + host-only identity stamps
 *     -> Bun/Lua (text data only)
 *     -> validate stamps still current
 *     -> MonacoHost apply
 *
 * Stale-operation semantics (reject stale):
 *   Snapshot carries selected text plus host-only document id, Monaco
 *   alternativeVersionId, and selection offsets. Lua never sees identity stamps.
 *   Apply verifies the active document and selection stamps still match; otherwise
 *   the operation is rejected. Apply never retargets a different document or an
 *   inactive buffer.
 *
 * Owner chain:
 *   Lua -> Bun bridge -> renderer seam -> MonacoHost.getSelectedText /
 *   MonacoHost.replacePrimarySelection (executeEdits) -> dirty/undo via Monaco model
 *
 * Absent by design: editor.get, open/activate/selectDocument, filesystem, host.call,
 * Monaco/ITextModel/IEditor objects, multi-cursor, live mid-invoke editor RPC.
 *
 * Capability isolation ≠ OS sandbox.
 */
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";

export const EDITOR_EXTENSION_LIMITS = {
  maxSelectionChars: LUA_EXTENSION_LIMITS.maxEditorSelectionChars,
  maxReplaceChars: LUA_EXTENSION_LIMITS.maxEditorSelectionChars,
} as const;

/**
 * Host-side snapshot for editor invoke/apply.
 * Only `selection` is exposed to the Lua guest.
 */
export type EditorSelectionSnapshot = {
  selection: string;
  /** Active document id at snapshot (`untitled:N` or `file:…`). */
  documentId: string;
  /** Monaco `ITextModel.getAlternativeVersionId()` at snapshot. */
  alternativeVersionId: number;
  /** Inclusive UTF-16 start offset of the primary selection. */
  startOffset: number;
  /** Exclusive UTF-16 end offset of the primary selection. */
  endOffset: number;
};

export type EditorMutationRequest = {
  /** Last replaceSelection wins when Lua calls it more than once. */
  replaceSelection?: string;
};

export type EditorSnapshotIdentity = Pick<
  EditorSelectionSnapshot,
  "documentId" | "alternativeVersionId" | "startOffset" | "endOffset"
>;

export function assertEditorSelectionWithinLimit(selection: string): string | null {
  if (selection.length > EDITOR_EXTENSION_LIMITS.maxSelectionChars.value) {
    return "editor selection exceeds size limit";
  }
  return null;
}

export function assertEditorReplaceWithinLimit(text: unknown): string | null {
  if (typeof text !== "string") {
    return "editor.replaceSelection requires a string";
  }
  if (text.length > EDITOR_EXTENSION_LIMITS.maxReplaceChars.value) {
    return "editor.replaceSelection exceeds size limit";
  }
  return null;
}

/** True when the live editor still matches the host-only snapshot stamps. */
export function editorSnapshotIsCurrent(
  snapshot: EditorSnapshotIdentity,
  live: EditorSnapshotIdentity | null,
): boolean {
  if (!live) {
    return false;
  }
  return (
    live.documentId === snapshot.documentId &&
    live.alternativeVersionId === snapshot.alternativeVersionId &&
    live.startOffset === snapshot.startOffset &&
    live.endOffset === snapshot.endOffset
  );
}
