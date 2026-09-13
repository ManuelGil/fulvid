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
  writingFocusMonacoOptions,
} from "../../../../src/mainview/modules/editor/writingFocus.ts";

// Intent: Writing Focus is session chrome on the editor route only.
// Native Full Screen stays BrowserWindow-owned and independent.
// Leave-editor targets must not point at chrome Writing Focus hides.
describe("writing focus", () => {
  test("applies only on the editor route, keeps leave targets usable, and stays independent of Full Screen", () => {
    writingFocusActive.value = false;
    expect(writingFocusHidesEditorChrome("editor")).toBe(false);

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(true);
    expect(writingFocusHidesEditorChrome("editor")).toBe(true);
    expect(writingFocusHidesEditorChrome("settings")).toBe(false);
    // Tabs are hidden under Writing Focus — restore must stay on Monaco/empty.
    expect(writingFocusLeaveEditorTarget(true)).toBe("monaco");
    expect(writingFocusLeaveEditorTarget(false)).toBe("empty-or-main");

    const monaco = writingFocusMonacoOptions(false, true);
    expect(monaco.minimap).toEqual({ enabled: false });
    expect(monaco.stickyScroll).toEqual({ enabled: false });

    let fullScreen = false;
    const window = {
      isFullScreen: () => fullScreen,
      setFullScreen: (next: boolean) => {
        fullScreen = next;
      },
    };
    expect(toggleNativeFullScreen(window)).toBe(true);
    expect(writingFocusActive.value).toBe(true);
    expect(fullScreen).toBe(true);
    // Fullscreen frames must not be persisted as the restored window bounds.
    expect(canPersistWindowFrame(fullScreen)).toBe(false);

    toggleWritingFocus();
    expect(writingFocusActive.value).toBe(false);
    expect(fullScreen).toBe(true);
    expect(toggleNativeFullScreen(window)).toBe(false);
  });
});
