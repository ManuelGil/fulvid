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

describe("session change marker mapping", () => {
  test("maps DiffEditor ranges to per-line marker kinds", () => {
    expect(changeMarkerSpecsFromLineChanges([])).toEqual([]);
    expect(changeMarkerSpecsFromLineChanges([modified])).toEqual([
      { kind: "modified", lineNumber: 2 },
    ]);
    expect(changeMarkerSpecsFromLineChanges([added])).toEqual([{ kind: "added", lineNumber: 3 }]);
    expect(changeMarkerSpecsFromLineChanges([deleted])).toEqual([
      { kind: "deleted", lineNumber: 4 },
    ]);
    expect(changeMarkerSpecsFromLineChanges([multiAdded])).toEqual([
      { kind: "added", lineNumber: 2 },
      { kind: "added", lineNumber: 3 },
      { kind: "added", lineNumber: 4 },
    ]);
    expect(changeMarkerSpecsFromLineChanges([modified, added, deleted])).toEqual([
      { kind: "modified", lineNumber: 2 },
      { kind: "added", lineNumber: 3 },
      { kind: "deleted", lineNumber: 4 },
    ]);
  });

  test("resolves a marker line to its contiguous hunk", () => {
    expect(lineChangeRangeForMarkerLine([modified], 2)).toEqual(modified);
    expect(lineChangeRangeForMarkerLine([added], 3)).toEqual(added);
    expect(lineChangeRangeForMarkerLine([deleted], 4)).toEqual(deleted);
    expect(lineChangeRangeForMarkerLine([multiAdded], 2)).toEqual(multiAdded);
    expect(lineChangeRangeForMarkerLine([multiAdded], 4)).toEqual(multiAdded);
    expect(lineChangeRangeForMarkerLine([modified, added, deleted], 3)).toEqual(added);
    expect(lineChangeRangeForMarkerLine([modified], 1)).toBeNull();
  });

  test("slices baseline and current text for a hunk preview", () => {
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
