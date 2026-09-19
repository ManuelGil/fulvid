/**
 * Arrow-key delta for the Settings category tablist.
 * Compact layout is a 2-column CSS grid with full-width group labels, so
 * index+/-2 does not match visual neighbors - keep linear movement.
 */
export function settingsCategoryNavDelta(key: string, compact: boolean): number {
  if (compact) {
    if (key === "ArrowRight" || key === "ArrowDown") {
      return 1;
    }
    if (key === "ArrowLeft" || key === "ArrowUp") {
      return -1;
    }
    return 0;
  }
  if (key === "ArrowDown") {
    return 1;
  }
  if (key === "ArrowUp") {
    return -1;
  }
  return 0;
}
