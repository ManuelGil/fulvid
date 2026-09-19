import { describe, expect, test } from "bun:test";

import { isGraphKeyTargetInScope } from "../../../../src/mainview/modules/graph/graphKeyScope.ts";

function elementWithClosest(match: string | null): Element {
  return {
    closest(selectors: string) {
      if (match === null) {
        return null;
      }
      return selectors.split(",").some((part) => part.trim() === match) ? this : null;
    },
  } as Element;
}

// Intent: graph shortcuts must survive focus restore to #main-content, not only
// nodes inside `.graph-workbench`, while remaining off app chrome.
describe("graph key scope", () => {
  test("accepts targets inside #main-content", () => {
    expect(isGraphKeyTargetInScope(elementWithClosest("#main-content"))).toBe(true);
  });

  test("refuses sidebar/chrome targets outside #main-content", () => {
    expect(isGraphKeyTargetInScope(elementWithClosest(null))).toBe(false);
    expect(isGraphKeyTargetInScope(null)).toBe(false);
  });
});
