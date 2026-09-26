/**
 * Pure helpers for open-document tab strip chrome.
 * Callers apply results through existing EditorTabs close/activate paths only.
 */

const CLOSE_CONTROL_SELECTOR = ".editor-tabs__close";

export type TabStripRevealTarget = {
  getClientRects: () => ArrayLike<unknown>;
  scrollIntoView: (options?: ScrollIntoViewOptions) => void;
};

/** Scroll the active tab into the strip when it has layout; no-op when hidden. */
export function revealTabInOverflowStrip(tab: TabStripRevealTarget | null | undefined): void {
  if (!tab || tab.getClientRects().length === 0) {
    return;
  }
  tab.scrollIntoView({ inline: "nearest", block: "nearest" });
}

export type TabAuxClickEvent = {
  button: number;
  target: EventTarget | null;
};

function isCloseControlTarget(target: EventTarget | null): boolean {
  if (!target || typeof target !== "object" || !("closest" in target)) {
    return false;
  }
  const closest = (target as { closest?: unknown }).closest;
  if (typeof closest !== "function") {
    return false;
  }
  return Boolean((closest as (selector: string) => unknown).call(target, CLOSE_CONTROL_SELECTOR));
}

/**
 * Whether a middle-button auxclick should close the tab via the existing close path.
 * Ignores the dedicated close control so middle-click there cannot double-fire.
 */
export function shouldCloseTabOnAuxClick(event: TabAuxClickEvent): boolean {
  if (event.button !== 1) {
    return false;
  }
  return !isCloseControlTarget(event.target);
}
