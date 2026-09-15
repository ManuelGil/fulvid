/**
 * Experimental editor capability contract (not a stable `api: 0` promise).
 *
 * Explicit guest surface (requires capability `editor` + `lua`):
 *   - editor.getSelection() → string (frozen primary-selection text snapshot)
 *   - editor.replaceSelection(text) → queues one replace; applied after Lua returns
 *
 * Protocol:
 *   renderer snapshots selection text → Bun/Lua (data only) → MonacoHost apply
 *
 * Apply semantics (why this remains experimental):
 *   Snapshot carries text only (no range / document id / model version).
 *   Apply uses the live primary selection (or cursor) in the active Monaco editor
 *   at apply time. If the user changes selection or document between snapshot and
 *   apply, the replacement targets that live range with the queued text.
 *   No editor events, subscriptions, or mid-invoke Monaco RPC.
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
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";

export const EDITOR_EXTENSION_LIMITS = {
  maxSelectionChars: LUA_EXTENSION_LIMITS.maxEditorSelectionChars,
  maxReplaceChars: LUA_EXTENSION_LIMITS.maxEditorSelectionChars,
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
