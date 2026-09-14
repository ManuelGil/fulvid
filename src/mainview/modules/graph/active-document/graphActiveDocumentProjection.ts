import type { DocumentBuffer } from "../../editor/document/documentBuffers";
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";

export type GraphActiveTarget = {
  focusPath: string;
  notes: readonly ScannedNote[];
  title: string;
};

export type GraphActiveFocusInput = {
  path: string;
};

/** Fields read when falling back to a virtual or standalone editor tab. */
export type GraphActiveBufferInput = Pick<
  DocumentBuffer,
  "id" | "absolutePath" | "rootPath" | "path" | "title"
>;

function scannedNoteForBuffer(buffer: GraphActiveBufferInput): ScannedNote {
  const path = buffer.path ?? buffer.id;
  const name =
    buffer.path?.split(/[/\\]/).pop() ?? buffer.absolutePath?.split(/[/\\]/).pop() ?? buffer.title;

  return {
    path,
    name,
    title: buffer.title,
    aliases: [],
    documentLinks: [],
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    words: 0,
  };
}

/**
 * Graph inputs from Focus, with a virtual/standalone fallback.
 *
 * Folder Graph consumes Focus, not `documentSession.activeId`. Peek does not
 * belong here. When Focus is empty, an untitled or dialog-opened buffer may
 * still project as an isolated node so Graph is usable without a Folder.
 */
export function graphActiveTargetFromInputs(
  focus: GraphActiveFocusInput | null,
  buffer: GraphActiveBufferInput | null,
  workspacePath: string | null,
  notesInContext: readonly ScannedNote[],
): GraphActiveTarget | null {
  if (focus) {
    const focused = notesInContext.find((note) => note.path === focus.path);
    if (focused) {
      return {
        focusPath: focus.path,
        notes: notesInContext,
        title: focused.title,
      };
    }
  }

  if (!buffer) {
    return null;
  }

  const attachedToOpenFolder = Boolean(
    buffer.path && workspacePath && buffer.rootPath === workspacePath,
  );
  if (attachedToOpenFolder) {
    return null;
  }

  const note = scannedNoteForBuffer(buffer);
  return {
    focusPath: note.path,
    notes: [note],
    title: buffer.title,
  };
}
