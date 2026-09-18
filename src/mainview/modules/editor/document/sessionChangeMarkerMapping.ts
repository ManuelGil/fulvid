/**
 * Pure mapping from Monaco-style line-change ranges to gutter markers and
 * hunk-scoped before/after text. No Monaco import.
 */

export type LineChangeRange = {
  originalStartLineNumber: number;
  originalEndLineNumber: number;
  modifiedStartLineNumber: number;
  modifiedEndLineNumber: number;
};

export type ChangeMarkerKind = "added" | "modified" | "deleted";

export type ChangeMarkerSpec = {
  kind: ChangeMarkerKind;
  lineNumber: number;
};

export type HunkSnippets = {
  before: string;
  after: string;
};

export function lineChangeRangeKey(change: LineChangeRange): string {
  return [
    change.originalStartLineNumber,
    change.originalEndLineNumber,
    change.modifiedStartLineNumber,
    change.modifiedEndLineNumber,
  ].join(":");
}

/** Deletion markers use `max(1, modifiedStart)` when `modifiedEnd === 0`. */
export function deletionMarkerLineNumber(change: LineChangeRange): number {
  return Math.max(1, change.modifiedStartLineNumber);
}

/** Resolve a gutter marker line to the contiguous DiffEditor hunk that owns it. */
export function lineChangeRangeForMarkerLine(
  changes: readonly LineChangeRange[],
  lineNumber: number,
): LineChangeRange | null {
  if (!Number.isInteger(lineNumber) || lineNumber < 1) {
    return null;
  }

  for (const change of changes) {
    const originalEmpty = change.originalEndLineNumber === 0;
    const modifiedEmpty = change.modifiedEndLineNumber === 0;

    if (modifiedEmpty && !originalEmpty) {
      if (deletionMarkerLineNumber(change) === lineNumber) {
        return change;
      }
      continue;
    }

    if (modifiedEmpty) {
      continue;
    }

    if (
      lineNumber >= change.modifiedStartLineNumber &&
      lineNumber <= change.modifiedEndLineNumber
    ) {
      return change;
    }
  }

  return null;
}

function sliceLines(text: string, startLine: number, endLine: number): string {
  if (endLine === 0 || startLine < 1 || endLine < startLine) {
    return "";
  }
  const lines = text.split("\n");
  return lines.slice(startLine - 1, endLine).join("\n");
}

/** Exact hunk ranges only (no surrounding context). */
export function hunkSnippetsFromTexts(
  baseline: string,
  current: string,
  hunk: LineChangeRange,
): HunkSnippets {
  const before =
    hunk.originalEndLineNumber === 0
      ? ""
      : sliceLines(baseline, hunk.originalStartLineNumber, hunk.originalEndLineNumber);
  const after =
    hunk.modifiedEndLineNumber === 0
      ? ""
      : sliceLines(current, hunk.modifiedStartLineNumber, hunk.modifiedEndLineNumber);
  return { before, after };
}

/**
 * Insert: originalEnd === 0. Delete: modifiedEnd === 0 (marker on adjacent current line).
 * Modify: both sides non-empty.
 */
export function changeMarkerSpecsFromLineChanges(
  changes: readonly LineChangeRange[],
): ChangeMarkerSpec[] {
  const specs: ChangeMarkerSpec[] = [];
  const seen = new Set<string>();

  const push = (kind: ChangeMarkerKind, lineNumber: number): void => {
    if (!Number.isInteger(lineNumber) || lineNumber < 1) {
      return;
    }
    const key = `${kind}:${lineNumber}`;
    if (seen.has(key)) {
      return;
    }
    seen.add(key);
    specs.push({ kind, lineNumber });
  };

  for (const change of changes) {
    const originalEmpty = change.originalEndLineNumber === 0;
    const modifiedEmpty = change.modifiedEndLineNumber === 0;

    if (originalEmpty && !modifiedEmpty) {
      for (
        let line = change.modifiedStartLineNumber;
        line <= change.modifiedEndLineNumber;
        line += 1
      ) {
        push("added", line);
      }
      continue;
    }

    if (modifiedEmpty && !originalEmpty) {
      push("deleted", deletionMarkerLineNumber(change));
      continue;
    }

    if (!originalEmpty && !modifiedEmpty) {
      for (
        let line = change.modifiedStartLineNumber;
        line <= change.modifiedEndLineNumber;
        line += 1
      ) {
        push("modified", line);
      }
    }
  }

  return specs;
}
