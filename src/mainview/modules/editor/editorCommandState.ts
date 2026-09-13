import { ref } from "vue";

export type EditorCommandState = {
  canUndo: boolean;
  canRedo: boolean;
  /** Whether the cursor line already has a session annotation (Quick Action label). */
  hasAnnotationAtCursor: boolean;
};

export const editorCommandState = ref<EditorCommandState>({
  canUndo: false,
  canRedo: false,
  hasAnnotationAtCursor: false,
});
