import { describe, expect, test } from "bun:test";

import {
  canPersistWindowFrame,
  toggleNativeFullScreen,
} from "../../../../src/bun/windowFullScreen.ts";
import {
  WRITING_FOCUS_KEPT_SELECTORS,
  toggleWritingFocus,
  writingFocusActive,
  writingFocusHidesEditorChrome,
  writingFocusLeaveEditorTarget,
  writingFocusMonacoOptions,
} from "../../../../src/mainview/modules/editor/writingFocus.ts";

// Intent: Writing Focus is session chrome on the editor route only.
// Keep-list ownership stays here - hide chrome, not capabilities.
describe("writing focus", () => {
  test("applies only on the editor route, keeps leave targets usable, and preserves capability surfaces", () => {
    writingFocusActive.value = false;
    expect(writingFocusHidesEditorChrome("editor")).toBe(false);
    expect(writingFocusLeaveEditorTarget(true)).toBe("tabs");

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(true);
    expect(writingFocusHidesEditorChrome("editor")).toBe(true);
    expect(writingFocusHidesEditorChrome("settings")).toBe(false);
    // Tabs are hidden under Writing Focus - restore must stay on Monaco/empty.
    expect(writingFocusLeaveEditorTarget(true)).toBe("monaco");
    expect(writingFocusLeaveEditorTarget(false)).toBe("empty-or-main");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".quick-actions");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain("[data-application-menu]");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".toast-host");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".dialog-host");

    const monaco = writingFocusMonacoOptions(false, true);
    expect(monaco.minimap).toEqual({ enabled: false });
    expect(monaco.stickyScroll).toEqual({ enabled: false });

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(false);
  });
});

// Intent: Writing Focus and native Full Screen stay orthogonal (all four combinations).
describe("writing focus and native fullscreen", () => {
  test("all four combinations stay independent", () => {
    writingFocusActive.value = false;
    let fullScreen = false;
    const window = {
      isFullScreen: () => fullScreen,
      setFullScreen: (next: boolean) => {
        fullScreen = next;
      },
    };

    expect(writingFocusActive.value).toBe(false);
    expect(fullScreen).toBe(false);
    expect(canPersistWindowFrame(fullScreen)).toBe(true);

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(true);
    expect(fullScreen).toBe(false);

    expect(toggleNativeFullScreen(window)).toBe(true);
    expect(writingFocusActive.value).toBe(true);
    expect(fullScreen).toBe(true);
    expect(canPersistWindowFrame(fullScreen)).toBe(false);

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(false);
    expect(fullScreen).toBe(true);

    expect(toggleNativeFullScreen(window)).toBe(false);
    expect(writingFocusActive.value).toBe(false);
    expect(fullScreen).toBe(false);
  });
});
