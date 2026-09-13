import { describe, expect, test } from "bun:test";

import {
  canPersistWindowFrame,
  toggleNativeFullScreen,
} from "../../../../src/bun/windowFullScreen.ts";
import {
  toggleWritingFocus,
  writingFocusActive,
  writingFocusHidesEditorChrome,
  writingFocusLeaveEditorTarget,
} from "../../../../src/mainview/modules/editor/writingFocus.ts";

// Intent: Focus is session-only, editor-route-only, and leave-editor targets stay usable.
// Rail navigation stays in writingFocusKeepsFocusTarget (includes .app-sidebar).
describe("writing focus", () => {
  test("applies only on the editor route and keeps leave-editor targets usable", () => {
    writingFocusActive.value = false;
    expect(writingFocusHidesEditorChrome("editor")).toBe(false);
    expect(writingFocusLeaveEditorTarget(true)).toBe("tabs");

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(true);
    expect(writingFocusHidesEditorChrome("editor")).toBe(true);
    expect(writingFocusHidesEditorChrome("settings")).toBe(false);
    expect(writingFocusLeaveEditorTarget(true)).toBe("monaco");
    expect(writingFocusLeaveEditorTarget(false)).toBe("empty-or-main");

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(false);
  });
});

// Intent: Writing Focus and native Full Screen stay orthogonal.
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
