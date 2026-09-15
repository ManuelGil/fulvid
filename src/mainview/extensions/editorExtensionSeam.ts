/**
 * Renderer seam for production Lua editor capabilities (Extension API v1).
 *
 * Monaco remains the owner of live text. This module only registers callbacks
 * that EditorPage wires to MonacoHost — never a second buffer.
 */
import type { EditorSelectionSnapshot } from "./editorCapability";

export type EditorExtensionSeam = {
  /**
   * Host-side apply context: selection text plus identity stamps.
   * Null when there is no active editor/buffer.
   */
  getApplyContext: () => EditorSelectionSnapshot | null;
  /**
   * Replace the primary selection (or insert at cursor when empty).
   * Empty string clears the selection. Returns false when no active editor.
   */
  replaceSelection: (text: string) => boolean;
  hasActiveEditor: () => boolean;
};

let seam: EditorExtensionSeam | null = null;

export function registerEditorExtensionSeam(next: EditorExtensionSeam | null): void {
  seam = next;
}

export function editorExtensionSeam(): EditorExtensionSeam | null {
  return seam;
}

export function resetEditorExtensionSeamForTests(): void {
  seam = null;
}
