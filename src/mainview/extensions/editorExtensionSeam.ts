/**
 * Renderer seam for Phase 3 Lua editor capabilities.
 *
 * Monaco remains the owner of live text. This module only registers callbacks
 * that EditorPage wires to MonacoHost — never a second buffer.
 */

export type EditorExtensionSeam = {
  /** Primary selection text, or "" when empty / no editor. */
  getSelection: () => string;
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
