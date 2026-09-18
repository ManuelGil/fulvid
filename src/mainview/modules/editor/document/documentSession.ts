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

/**
 * Presentation number for `untitled:N`. Not a recovery identity and not
 * persisted across restarts - only the smallest unused positive integer among
 * currently open Untitled tabs.
 */
export function smallestAvailableUntitledNumber(usedNumbers: Iterable<number>): number {
  const used = new Set<number>();
  for (const value of usedNumbers) {
    if (Number.isInteger(value) && value > 0) {
      used.add(value);
    }
  }
  let candidate = 1;
  while (used.has(candidate)) {
    candidate += 1;
  }
  return candidate;
}

export function untitledNumberFromId(id: DocumentId): number | null {
  const match = /^untitled:(\d+)$/.exec(id);
  if (!match) {
    return null;
  }
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

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

/** Allocate `untitled:N` with the smallest available N among open tabs. */
export function nextUntitledId(): DocumentId {
  const used: number[] = [];
  for (const id of openIds.value) {
    const number = untitledNumberFromId(id);
    if (number !== null) {
      used.push(number);
    }
  }
  return `untitled:${smallestAvailableUntitledNumber(used)}`;
}
