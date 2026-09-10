import type { DocumentBuffer } from "../editor/document/documentBuffers";
import type { ScannedNote } from "../workspace/filesystem/workspaceTypes";

function noteFromStandaloneBuffer(buffer: DocumentBuffer): ScannedNote {
  const path = buffer.absolutePath ?? buffer.id;
  const name = buffer.absolutePath?.split(/[/\\]/).pop() ?? buffer.title;

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
    tokens: 0,
    words: 0,
    content: buffer.model.getValue(),
  };
}

/** Merge unsaved Monaco buffer content into scanned notes for search. */
export function notesWithOpenBufferContent(
  notes: readonly ScannedNote[],
  buffers: readonly DocumentBuffer[],
  rootPath: string | undefined,
): ScannedNote[] {
  const merged = new Map(notes.map((note) => [note.path, note] as const));

  for (const buffer of buffers) {
    if (rootPath === undefined && buffer.rootPath === null) {
      // Search remains useful without a Folder by indexing open standalone tabs.
      void buffer.changeVersion.value;
      const note = noteFromStandaloneBuffer(buffer);
      merged.set(note.path, note);
      continue;
    }

    if (!buffer.path || buffer.rootPath !== rootPath) {
      continue;
    }
    // Track model edits so search sees unsaved content.
    void buffer.changeVersion.value;
    const note = merged.get(buffer.path);
    if (note) {
      merged.set(buffer.path, {
        ...note,
        content: buffer.model.getValue(),
      });
    }
  }

  return [...merged.values()];
}
