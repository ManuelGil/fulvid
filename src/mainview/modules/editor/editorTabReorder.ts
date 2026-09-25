/**
 * Pure index math for open-document tab reordering.
 * Callers apply the result through `reorderOpenDocuments` only.
 */

/** Next index for Alt+Arrow tab move, or null at the strip edge (no wrap). */
export function adjacentTabReorderIndex(
  fromIndex: number,
  direction: -1 | 1,
  length: number,
): number | null {
  if (length < 2 || fromIndex < 0 || fromIndex >= length) {
    return null;
  }
  const toIndex = fromIndex + direction;
  if (toIndex < 0 || toIndex >= length) {
    return null;
  }
  return toIndex;
}

/**
 * Target index for `reorderOpenDocuments` when dropping onto `overIndex`.
 * `placeAfter` means insert after the hovered tab in the pre-remove order.
 */
export function tabDropReorderIndex(
  fromIndex: number,
  overIndex: number,
  placeAfter: boolean,
): number {
  if (fromIndex === overIndex && !placeAfter) {
    return fromIndex;
  }
  let toIndex = placeAfter ? overIndex + 1 : overIndex;
  if (fromIndex < toIndex) {
    toIndex -= 1;
  }
  return toIndex;
}
