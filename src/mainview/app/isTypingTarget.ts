type ElementLike = {
  tagName?: unknown;
  isContentEditable?: unknown;
  closest?: (selectors: string) => unknown;
};

function elementLike(target: EventTarget | null): ElementLike | null {
  return target !== null && typeof target === "object" ? (target as ElementLike) : null;
}

function closest(target: ElementLike, selectors: string): boolean {
  return typeof target.closest === "function" && target.closest(selectors) !== null;
}

/** Text fields and Monaco. App-global shortcuts use this so buttons still receive single keys. */
export function isTextEntryTarget(target: EventTarget | null): boolean {
  const element = elementLike(target);
  if (!element) {
    return false;
  }

  return (
    element.tagName === "INPUT" ||
    element.tagName === "TEXTAREA" ||
    element.tagName === "SELECT" ||
    element.isContentEditable === true ||
    closest(element, ".monaco-editor")
  );
}

/** Text fields plus inspector/buttons. Graph and Search keys use this so chrome does not steal them. */
export function isTypingTarget(target: EventTarget | null): boolean {
  const element = elementLike(target);
  if (!element || isTextEntryTarget(target)) {
    return Boolean(element);
  }

  return (
    closest(element, ".inspector-panel") ||
    element.tagName === "BUTTON" ||
    closest(element, 'button, [role="button"], [role="slider"], [role="radio"], [role="option"]')
  );
}
