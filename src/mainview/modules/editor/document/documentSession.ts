/**
 * Open document set: which tabs exist and which one the editor shows.
 *
 * `activeId` is the only editor selection. Focus (Graph/Context) is separate
 * and must not gate opening a document. Buffers and Monaco models live in
 * `documentBuffers`; this module owns identity and order. Surfaces open a
 * document through `openOrActivate` there, not by writing `activeId` here.
 */
import { ref } from "vue";

export type DocumentKind = "virtual" | "persisted";
/** Virtual: `untitled:N`. Persisted: `file:${absolutePath}`. */
export type DocumentId = string;
export type DocumentRevealPosition = {
  lineNumber: number;
  column: number;
};

/**
 * Editor selection is session state, not graph/context state.
 *
 * Focus is folder-scoped reading metadata for Graph and Context. `activeId`
 * alone decides which open document the editor shows.
 */
export const activeId = ref<DocumentId | null>(null);
export const openIds = ref<DocumentId[]>([]);
/** One-shot editor reveal after Search or link navigation. Consumed by EditorPage. */
export const pendingReveal = ref<(DocumentRevealPosition & { documentId: DocumentId }) | null>(
  null,
);

let untitledSequence = 0;

/**
 * Set the editor's active tab only. Does not change Focus.
 * UI code that represents "the user selected this tab" should call
 * `selectDocument` in `documentBuffers` so Graph/Context stay aligned.
 */
export function activateDocument(id: DocumentId): void {
  activeId.value = id;
  touchDocumentMru(id);
}

const documentMru = ref<DocumentId[]>([]);

export function touchDocumentMru(id: DocumentId): void {
  documentMru.value = [id, ...documentMru.value.filter((openId) => openId !== id)];
}

export function removeDocumentMru(id: DocumentId): void {
  documentMru.value = documentMru.value.filter((openId) => openId !== id);
}

function mruIndexAfter(currentIndex: number, direction: 1 | -1, stackLength: number): number {
  if (currentIndex < 0) {
    return direction === 1 ? 1 : stackLength - 1;
  }
  return (currentIndex + direction + stackLength) % stackLength;
}

export function nextMruDocument(direction: 1 | -1): DocumentId | null {
  const openSet = new Set(openIds.value);
  const mruStack = documentMru.value.filter((id) => openSet.has(id));
  if (mruStack.length < 2) {
    return null;
  }
  const currentIndex = activeId.value ? mruStack.indexOf(activeId.value) : -1;
  const nextIndex = mruIndexAfter(currentIndex, direction, mruStack.length);
  return mruStack[nextIndex] ?? null;
}

export function registerDocument(id: DocumentId): void {
  if (!openIds.value.includes(id)) {
    openIds.value = [...openIds.value, id];
  }
  touchDocumentMru(id);
}

export function unregisterDocument(id: DocumentId): void {
  openIds.value = openIds.value.filter((openId) => openId !== id);
  removeDocumentMru(id);
  if (pendingReveal.value?.documentId === id) {
    pendingReveal.value = null;
  }
}

/**
 * Keep the open set, MRU, `activeId`, and pending reveal aligned when a
 * buffer's identity changes (Save As or file rename). Callers must update
 * `documentBuffers` in the same turn.
 */
export function replaceDocumentId(previousId: DocumentId, nextId: DocumentId): void {
  openIds.value = openIds.value.map((id) => (id === previousId ? nextId : id));
  documentMru.value = documentMru.value.map((id) => (id === previousId ? nextId : id));
  if (activeId.value === previousId) {
    activeId.value = nextId;
  }
  if (pendingReveal.value?.documentId === previousId) {
    pendingReveal.value = {
      ...pendingReveal.value,
      documentId: nextId,
    };
  }
}

export function clearSessionDocuments(): void {
  openIds.value = [];
  documentMru.value = [];
  activeId.value = null;
  pendingReveal.value = null;
}

export function clearActiveDocument(id: DocumentId, replacementId: DocumentId | null = null): void {
  if (activeId.value === id) {
    activeId.value = replacementId;
  }
}

export function consumePendingReveal(documentId: DocumentId): DocumentRevealPosition | null {
  const request = pendingReveal.value;
  if (!request || request.documentId !== documentId) {
    return null;
  }
  pendingReveal.value = null;
  return {
    lineNumber: request.lineNumber,
    column: request.column,
  };
}

/** Allocate the next `untitled:N` identity. Virtual until Save As. */
export function nextUntitledId(): DocumentId {
  untitledSequence += 1;
  return `untitled:${untitledSequence}`;
}
