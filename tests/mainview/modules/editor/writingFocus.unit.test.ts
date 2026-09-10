import { describe, expect, test } from "bun:test";

import {
  toggleWritingFocus,
  writingFocusActive,
  writingFocusHidesEditorChrome,
  writingFocusLeaveEditorTarget,
} from "../../../../src/mainview/modules/editor/writingFocus.ts";

// Intent: Focus is session-only, editor-route-only, and leave-editor targets stay usable.
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
