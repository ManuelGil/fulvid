/**
 * Editor capability: snapshot selection text + host-only stamps -> Lua text ->
 * reject-stale Monaco apply. Guest never sees Monaco objects or identity stamps.
 */
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";

export const EDITOR_EXTENSION_LIMITS = {
  maxSelectionChars: LUA_EXTENSION_LIMITS.maxEditorSelectionChars,
} as const;

/** Host-side snapshot. Only `selection` is exposed to the Lua guest. */
export type EditorSelectionSnapshot = {
  selection: string;
  documentId: string;
  alternativeVersionId: number;
  startOffset: number;
  endOffset: number;
};

export type EditorMutationRequest = {
  replaceSelection?: string;
};

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
  if (text.length > EDITOR_EXTENSION_LIMITS.maxSelectionChars.value) {
    return "editor.replaceSelection exceeds size limit";
  }
  return null;
}

/** True when the live editor still matches the host-only snapshot stamps. */
export function editorSnapshotIsCurrent(
  snapshot: EditorSelectionSnapshot,
  live: EditorSelectionSnapshot | null,
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
