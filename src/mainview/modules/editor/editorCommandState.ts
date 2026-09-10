import { ref } from "vue";

export type EditorCommandState = {
  canUndo: boolean;
  canRedo: boolean;
};

export const editorCommandState = ref<EditorCommandState>({
  canUndo: false,
  canRedo: false,
});
