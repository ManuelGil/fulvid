/**
 * Phase 3 editor capability contract (selection transform only).
 *
 * Snapshot/apply protocol — not live Monaco RPC from Bun (avoids deadlock on the
 * in-flight invokeExtensionLuaCommand request):
 *   1. Renderer snapshots primary selection (MonacoHost.getSelectedText)
 *   2. Bun installs editor.getSelection → frozen snapshot; editor.replaceSelection queues
 *   3. After Lua returns, renderer applies via MonacoHost.replacePrimarySelection
 *
 * Out of scope for this slice: editor.get (full buffer), filesystem, multi-cursor.
 * Capability isolation ≠ OS sandbox. No host object references enter Lua.
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
