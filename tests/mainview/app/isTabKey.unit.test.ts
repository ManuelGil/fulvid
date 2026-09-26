import { describe, expect, test } from "bun:test";

import { isTabKey } from "../../../src/mainview/app/isTabKey.ts";

describe("isTabKey", () => {
  test("matches plain Tab", () => {
    expect(isTabKey({ key: "Tab", code: "Tab" })).toBe(true);
  });

  test("matches ISO_Left_Tab used by some WebKit Shift+Tab paths", () => {
    expect(isTabKey({ key: "ISO_Left_Tab", code: "Tab" })).toBe(true);
    expect(isTabKey({ key: "ISO_Left_Tab", code: "ISO_Left_Tab" })).toBe(true);
  });

  test("matches by code when key is layout-specific but code is Tab", () => {
    expect(isTabKey({ key: "Unidentified", code: "Tab" })).toBe(true);
  });

  test("rejects unrelated keys", () => {
    expect(isTabKey({ key: "t", code: "KeyT" })).toBe(false);
    expect(isTabKey({ key: "PageDown", code: "PageDown" })).toBe(false);
  });
});
