/**
 * Pure index math for open-document adjacent activation (Ctrl/Cmd+Tab,
 * Ctrl/Cmd+Shift+Tab, PageDown/PageUp). Callers pass `openBuffers` order.
 * Wrap is intentional. Distinct from Alt+Arrow reorder (no wrap).
 */
export function adjacentOpenDocumentIndex(
  currentIndex: number,
  direction: -1 | 1,
  length: number,
): number | null {
  if (currentIndex < 0 || length < 2) {
    return null;
  }
  return (currentIndex + direction + length) % length;
}
