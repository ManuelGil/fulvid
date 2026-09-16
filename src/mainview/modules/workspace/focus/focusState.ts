/**
 * Folder-scoped Graph and Document Context target.
 *
 * The editor's active document belongs to DocumentSession (`activeId`).
 * Graph and Context read Focus; they do not follow the editor tab on their
 * own. Virtual and standalone documents do not create folder Focus.
 *
 * Peek reads another document in Context without moving Focus, so Graph
 * does not re-project. Setting focus never mutates folder content.
 */
import { ref } from "vue";

import type { ScannedNote } from "../filesystem/workspaceTypes";

export type Focus = {
  path: string;
  workspacePath: string;
};

export const currentFocus = ref<Focus | null>(null);

const activeWorkspacePath = ref<string | null>(null);

/**
 * Inspector open state. Reading target may be a peek or the focus itself.
 */
export const inspectorOpen = ref(false);

/** Path being read in the Inspector. Null means "use focus". */
export const inspectionPath = ref<string | null>(null);

export function openInspector(): void {
  inspectorOpen.value = true;
}

export function closeInspector(): void {
  inspectorOpen.value = false;
  inspectionPath.value = null;
}

/**
 * Read a document without changing Focus.
 * Graph neighborhood stays stable while the Inspector updates.
 */
export function peekDocument(path: string): void {
  inspectionPath.value = path;
  inspectorOpen.value = true;
}

export function isFocusValidForWorkspace(
  focus: Focus | null,
  workspacePath: string | null,
): boolean {
  return Boolean(focus && workspacePath && focus.workspacePath === workspacePath);
}

function clearFocus(): void {
  currentFocus.value = null;
  closeInspector();
}

export function clearFocusState(): void {
  clearFocus();
}

export function bindFocusToWorkspace(workspacePath: string | null): void {
  if (activeWorkspacePath.value !== workspacePath) {
    clearFocus();
  }

  activeWorkspacePath.value = workspacePath;
}

function setFocus(path: string): void {
  if (!activeWorkspacePath.value) {
    return;
  }

  currentFocus.value = {
    path,
    workspacePath: activeWorkspacePath.value,
  };
}

/** Commit Focus while keeping the Inspector on that document. */
export function focusDocument(path: string): void {
  setFocus(path);
  inspectionPath.value = path;
}

export function clearFocusForDocument(path: string): void {
  if (currentFocus.value?.path === path) {
    clearFocus();
  }
}

/** Display title for a path: scanned title, or the filename as fallback. */
export function noteTitle(path: string, notes: readonly ScannedNote[]): string {
  const scanned = notes.find((note) => note.path === path);
  if (scanned) {
    return scanned.title;
  }

  const parts = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return parts[parts.length - 1] || path;
}
