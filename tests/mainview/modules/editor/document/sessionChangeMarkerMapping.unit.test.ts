import { describe, expect, test } from "bun:test";

import {
  changeMarkerSpecsFromLineChanges,
  hunkSnippetsFromTexts,
  lineChangeRangeForMarkerLine,
} from "../../../../../src/mainview/modules/editor/document/sessionChangeMarkerMapping.ts";

const modified = {
  originalStartLineNumber: 2,
  originalEndLineNumber: 2,
  modifiedStartLineNumber: 2,
  modifiedEndLineNumber: 2,
};

const added = {
  originalStartLineNumber: 1,
  originalEndLineNumber: 0,
  modifiedStartLineNumber: 3,
  modifiedEndLineNumber: 3,
};

const deleted = {
  originalStartLineNumber: 4,
  originalEndLineNumber: 4,
  modifiedStartLineNumber: 4,
  modifiedEndLineNumber: 0,
};

const multiAdded = {
  originalStartLineNumber: 1,
  originalEndLineNumber: 0,
  modifiedStartLineNumber: 2,
  modifiedEndLineNumber: 4,
};

// Intent: marker lines map to hunk kinds; a click resolves the owning hunk;
// preview text is exact baseline/current slices for that hunk only.
describe("session change marker mapping", () => {
  test("maps kinds, resolves hunks, and slices before/after text", () => {
    expect(changeMarkerSpecsFromLineChanges([])).toEqual([]);
    expect(changeMarkerSpecsFromLineChanges([modified, added, deleted])).toEqual([
      { kind: "modified", lineNumber: 2 },
      { kind: "added", lineNumber: 3 },
      { kind: "deleted", lineNumber: 4 },
    ]);
    expect(changeMarkerSpecsFromLineChanges([multiAdded])).toEqual([
      { kind: "added", lineNumber: 2 },
      { kind: "added", lineNumber: 3 },
      { kind: "added", lineNumber: 4 },
    ]);

    expect(lineChangeRangeForMarkerLine([modified, added, deleted], 3)).toEqual(added);
    expect(lineChangeRangeForMarkerLine([multiAdded], 4)).toEqual(multiAdded);
    expect(lineChangeRangeForMarkerLine([deleted], 4)).toEqual(deleted);
    expect(lineChangeRangeForMarkerLine([modified], 1)).toBeNull();

    const baseline = "alpha\nbeta\ngamma\ndelta";
    const current = "alpha MOD\nbeta\nINSERTED\ngamma";
    expect(
      hunkSnippetsFromTexts(baseline, current, {
        originalStartLineNumber: 1,
        originalEndLineNumber: 1,
        modifiedStartLineNumber: 1,
        modifiedEndLineNumber: 1,
      }),
    ).toEqual({ before: "alpha", after: "alpha MOD" });
    expect(
      hunkSnippetsFromTexts(baseline, current, {
        originalStartLineNumber: 2,
        originalEndLineNumber: 0,
        modifiedStartLineNumber: 3,
        modifiedEndLineNumber: 3,
      }),
    ).toEqual({ before: "", after: "INSERTED" });
    expect(
      hunkSnippetsFromTexts(baseline, current, {
        originalStartLineNumber: 4,
        originalEndLineNumber: 4,
        modifiedStartLineNumber: 4,
        modifiedEndLineNumber: 0,
      }),
    ).toEqual({ before: "delta", after: "" });
    expect(
      hunkSnippetsFromTexts("a\nb\nc\nd", "a\nX\nY\nZ\nd", {
        originalStartLineNumber: 2,
        originalEndLineNumber: 3,
        modifiedStartLineNumber: 2,
        modifiedEndLineNumber: 4,
      }),
    ).toEqual({ before: "b\nc", after: "X\nY\nZ" });
  });
});
