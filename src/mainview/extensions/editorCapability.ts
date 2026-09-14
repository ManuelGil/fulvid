/**
 * Phase 3 editor capability contract (experimental, selection transform only).
 *
 * Explicit guest surface (requires capability `editor` + `lua`):
 *   - editor.getSelection() → string (frozen primary-selection snapshot)
 *   - editor.replaceSelection(text) → queues one replace; applied after return
 *
 * Owner chain:
 *   Lua → Bun bridge → renderer seam → MonacoHost.getSelectedText /
 *   MonacoHost.replacePrimarySelection (executeEdits) → dirty/undo via Monaco model
 *
 * Absent by design: editor.get, open/activate/selectDocument, filesystem, host.call,
 * Monaco/ITextModel/IEditor objects, multi-cursor, live mid-invoke editor RPC.
 *
 * Capability isolation ≠ OS sandbox.
 */
import { LUA_SPIKE_LIMITS } from "../../bun/extensions/lua/luaLimits";

export const EDITOR_EXTENSION_LIMITS = {
  maxSelectionChars: LUA_SPIKE_LIMITS.maxEditorSelectionChars,
  maxReplaceChars: LUA_SPIKE_LIMITS.maxEditorSelectionChars,
} as const;

export type EditorSelectionSnapshot = {
  selection: string;
};

export type EditorMutationRequest = {
  /** Last replaceSelection wins when Lua calls it more than once. */
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
  if (text.length > EDITOR_EXTENSION_LIMITS.maxReplaceChars.value) {
    return "editor.replaceSelection exceeds size limit";
  }
  return null;
}
