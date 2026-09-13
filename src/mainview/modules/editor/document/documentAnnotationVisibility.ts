/**
 * Session presentation for document annotations.
 *
 * Distinct from annotation existence (WeakMap + Monaco decorations) and from
 * the persisted editor preference `showDocumentAnnotations` (startup default).
 * Toggling visibility never deletes annotations or writes the filesystem.
 */
import { ref } from "vue";

/** Current glyph/hover presentation. Seeded from settings at startup / reset. */
export const documentAnnotationsVisible = ref(true);

export function setDocumentAnnotationsVisible(visible: boolean): void {
  documentAnnotationsVisible.value = visible;
}

export function toggleDocumentAnnotationsVisible(): boolean {
  documentAnnotationsVisible.value = !documentAnnotationsVisible.value;
  return documentAnnotationsVisible.value;
}

/** Apply a persisted preferred default without touching annotation content. */
export function syncDocumentAnnotationsVisibleFromPreference(preferred: boolean): void {
  documentAnnotationsVisible.value = preferred;
}
