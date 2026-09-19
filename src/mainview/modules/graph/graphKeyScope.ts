/**
 * Graph application keys belong to the main stage, not app chrome
 * (sidebar, menubar, quick actions, right panels).
 *
 * Scope is `#main-content` (not only `.graph-workbench`) so shortcuts still
 * work after Context closes and focus restores to main, while staying out of
 * shell chrome. Buttons/inspector are filtered separately via `isTypingTarget`.
 */
export function isGraphKeyTargetInScope(target: EventTarget | null): boolean {
  if (target === null || typeof target !== "object") {
    return false;
  }
  const element = target as { closest?: (selectors: string) => unknown };
  return typeof element.closest === "function" && element.closest("#main-content") !== null;
}
