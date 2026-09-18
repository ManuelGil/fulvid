import { describe, expect, test } from "bun:test";

import {
  smallestAvailableUntitledNumber,
  untitledNumberFromId,
} from "../../../../../src/mainview/modules/editor/document/documentSession.ts";

// Intent: Untitled presentation numbers are smallest-available positive integers;
// recovery identity is separate (parsed only from untitled:N ids).
describe("untitled presentation numbers", () => {
  test("assigns smallest available positive numbers and parses untitled ids only", () => {
    expect(smallestAvailableUntitledNumber([])).toBe(1);
    expect(smallestAvailableUntitledNumber([1])).toBe(2);
    expect(smallestAvailableUntitledNumber([1, 2, 3])).toBe(4);
    expect(smallestAvailableUntitledNumber([1, 3])).toBe(2);
    expect(smallestAvailableUntitledNumber([2, 3])).toBe(1);
    expect(smallestAvailableUntitledNumber([0, -1, 1.5, 1])).toBe(2);

    expect(untitledNumberFromId("untitled:1")).toBe(1);
    expect(untitledNumberFromId("untitled:12")).toBe(12);
    expect(untitledNumberFromId("file:/tmp/note.md")).toBeNull();
    expect(untitledNumberFromId("untitled:0")).toBeNull();
  });
});
