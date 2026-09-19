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
  writingFocusKeepsFocusTarget,
  writingFocusLeaveEditorTarget,
  writingFocusMonacoOptions,
} from "../../../../src/mainview/modules/editor/writingFocus.ts";

// Intent: Writing Focus is session chrome on the editor route only, and stays
// orthogonal to native Full Screen (all four combinations). Host fullscreen
// fails closed and never persists a fullscreen frame as normal bounds.
describe("writing focus", () => {
  test("route rules stay independent of native fullscreen", () => {
    writingFocusActive.value = false;
    let fullScreen = false;
    const window = {
      isFullScreen: () => fullScreen,
      setFullScreen: (next: boolean) => {
        fullScreen = next;
      },
    };

    expect(writingFocusHidesEditorChrome("editor")).toBe(false);
    expect(writingFocusLeaveEditorTarget(true)).toBe("tabs");
    expect(canPersistWindowFrame(fullScreen)).toBe(true);

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(true);
    expect(fullScreen).toBe(false);
    expect(writingFocusHidesEditorChrome("editor")).toBe(true);
    expect(writingFocusHidesEditorChrome("settings")).toBe(false);
    // Tabs are hidden under Writing Focus - restore must stay on Monaco/empty.
    expect(writingFocusLeaveEditorTarget(true)).toBe("monaco");
    expect(writingFocusLeaveEditorTarget(false)).toBe("empty-or-main");
    expect(WRITING_FOCUS_KEPT_SELECTORS).toContain(".preview-pane");
    expect(WRITING_FOCUS_KEPT_SELECTORS).not.toContain(".markdown-preview");
    // Bun has no Element; kept-target filtering for real nodes stays GUI evidence.
    expect(writingFocusKeepsFocusTarget(null)).toBe(false);
    expect(writingFocusKeepsFocusTarget({} as EventTarget)).toBe(false);

    const monaco = writingFocusMonacoOptions(false, true);
    expect(monaco.minimap).toEqual({ enabled: false });
    expect(monaco.stickyScroll).toEqual({ enabled: false });

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

    // Host errors fail closed; do not flip fullscreen state.
    expect(
      toggleNativeFullScreen({
        isFullScreen: () => false,
        setFullScreen: () => {
          throw new Error("gone");
        },
      }),
    ).toBe(false);
  });
});
