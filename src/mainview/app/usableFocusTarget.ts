/**
 * Whether a restore target can actually receive focus.
 * Skip disconnected, disabled, or inert nodes (overlays; statusbar while Focus).
 */
export function isUsableFocusTarget(element: EventTarget | null): element is HTMLElement {
  if (element === null || typeof HTMLElement === "undefined") {
    return false;
  }
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    return false;
  }
  if (element.matches(":disabled")) {
    return false;
  }
  return element.closest("[inert]") === null;
}

/** Restore to `previous` when usable; otherwise Monaco, empty-state, or main. */
export function restoreUsableFocus(previous: EventTarget | null): void {
  if (isUsableFocusTarget(previous)) {
    previous.focus({ preventScroll: true });
    return;
  }
  const monaco = document.querySelector<HTMLElement>(
    ".monaco-editor textarea.inputarea, .monaco-editor [contenteditable='true']",
  );
  if (isUsableFocusTarget(monaco)) {
    monaco.focus({ preventScroll: true });
    return;
  }
  const emptyAction = document.querySelector<HTMLElement>(".editor-empty-workspace button");
  if (isUsableFocusTarget(emptyAction)) {
    emptyAction.focus({ preventScroll: true });
    return;
  }
  const main = document.getElementById("main-content");
  if (isUsableFocusTarget(main)) {
    main.focus({ preventScroll: true });
  }
}
