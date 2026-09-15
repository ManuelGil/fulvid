/**
 * Renderer seam for production Lua editor/document/decoration capabilities
 * (Extension API v1).
 *
 * Monaco remains the owner of live text and decorations. This module only
 * registers callbacks that EditorPage wires to MonacoHost - never a second buffer.
 */
import type { EditorSelectionSnapshot } from "./editorCapability";
import type { DocumentSnapshot } from "./documentCapability";
import type { ExtensionDecorationRange } from "./decorationCapability";

export type EditorExtensionSeam = {
  /**
   * Host-side apply context: selection text plus identity stamps.
   * Null when there is no active editor/buffer.
   */
  getApplyContext: () => EditorSelectionSnapshot | null;
  /**
   * Full-document snapshot for document/decorations capabilities.
   * Null when there is no active editor/buffer.
   */
  getDocumentContext: () => DocumentSnapshot | null;
  /**
   * Replace the primary selection (or insert at cursor when empty).
   * Empty string clears the selection. Returns false when no active editor.
   */
  replaceSelection: (text: string) => boolean;
  /** Reveal a 1-based line/column in the active editor. */
  reveal: (lineNumber: number, column: number) => boolean;
  /** Replace this extension's decoration set on the active editor. */
  setExtensionDecorations: (
    extensionId: string,
    ranges: readonly ExtensionDecorationRange[],
  ) => boolean;
  /** Clear this extension's decorations on the active editor. */
  clearExtensionDecorations: (extensionId: string) => boolean;
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
