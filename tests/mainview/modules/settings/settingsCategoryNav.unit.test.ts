import { describe, expect, test } from "bun:test";

import { settingsCategoryNavDelta } from "../../../../src/mainview/modules/settings/settingsCategoryNav.ts";

// Intent: compact Settings category nav must not skip categories (former +/-2).
describe("settings category keyboard", () => {
  test("compact and vertical tablists move by one category", () => {
    expect(settingsCategoryNavDelta("ArrowDown", false)).toBe(1);
    expect(settingsCategoryNavDelta("ArrowUp", false)).toBe(-1);
    expect(settingsCategoryNavDelta("ArrowRight", false)).toBe(0);
    expect(settingsCategoryNavDelta("ArrowLeft", false)).toBe(0);

    expect(settingsCategoryNavDelta("ArrowDown", true)).toBe(1);
    expect(settingsCategoryNavDelta("ArrowUp", true)).toBe(-1);
    expect(settingsCategoryNavDelta("ArrowRight", true)).toBe(1);
    expect(settingsCategoryNavDelta("ArrowLeft", true)).toBe(-1);
    expect(settingsCategoryNavDelta("Home", true)).toBe(0);
  });
});
