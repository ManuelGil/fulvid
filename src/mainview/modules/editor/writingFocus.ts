import { ref } from "vue";

/** Session-only writing focus. Not a persisted editor preference. */
export const writingFocusActive = ref(false);

export function toggleWritingFocus(): void {
  writingFocusActive.value = !writingFocusActive.value;
}

/** Focus chrome overlay applies only on the editor route. */
export function writingFocusHidesEditorChrome(routeName: unknown): boolean {
  return writingFocusActive.value && routeName === "editor";
}

/**
 * Where to send keyboard focus when leaving Monaco or restoring editor chrome.
 * Writing Focus must not target hidden tabs.
 */
export function writingFocusLeaveEditorTarget(
  hasOpenDocument: boolean,
): "monaco" | "tabs" | "empty-or-main" {
  if (writingFocusActive.value) {
    return hasOpenDocument ? "monaco" : "empty-or-main";
  }
  return hasOpenDocument ? "tabs" : "empty-or-main";
}

/**
 * Capability surfaces that stay usable while Writing Focus hides secondary chrome.
 * This is not a visibility exception list: hide chrome, not capabilities.
 * Keep Quick Actions (Writing Focus toggle lives there), application menu, dialogs,
 * toasts, context menus, skip/main, Monaco/Preview/empty state, and sidebar rail.
 * Do not inert/hide the Quick Actions container just because surrounding chrome is dimmed.
 */
export const WRITING_FOCUS_KEPT_SELECTORS = [
  ".monaco-editor",
  ".editor-empty-workspace",
  ".markdown-preview",
  "[data-application-menu]",
  ".quick-actions",
  ".app-sidebar",
  ".skip-link",
  "#main-content",
  ".dialog-host",
  ".context-menu",
  ".toast-host",
  ".app-shell__panel",
] as const;

const WRITING_FOCUS_KEPT_SELECTOR = WRITING_FOCUS_KEPT_SELECTORS.join(", ");

export function writingFocusKeepsFocusTarget(element: EventTarget | null): boolean {
  if (!(element instanceof Element)) {
    return false;
  }
  return Boolean(element.closest(WRITING_FOCUS_KEPT_SELECTOR));
}

/**
 * Monaco option overlay for writing focus. Session-only; does not patch
 * settingsStore. Typewriter padding is skipped when reduced-motion is on or
 * the typewriter preference is off. Minimap and sticky headings are always
 * off in Focus so the writing surface stays clear.
 */
export function writingFocusMonacoOptions(
  reducedMotion: boolean,
  typewriterScrolling = true,
): {
  cursorSurroundingLines: number;
  cursorSurroundingLinesStyle: "all";
  scrollBeyondLastLine: boolean;
  stickyScroll: { enabled: false };
  minimap: { enabled: false };
  padding: { top: number; bottom: number };
} {
  const typewriter = typewriterScrolling
    ? {
        cursorSurroundingLines: reducedMotion ? 3 : 8,
        scrollBeyondLastLine: true,
        padding: { top: reducedMotion ? 18 : 72, bottom: reducedMotion ? 18 : 72 },
      }
    : {
        cursorSurroundingLines: 0,
        scrollBeyondLastLine: false,
        padding: { top: 18, bottom: 18 },
      };
  return {
    ...typewriter,
    cursorSurroundingLinesStyle: "all",
    stickyScroll: { enabled: false },
    minimap: { enabled: false },
  };
}
