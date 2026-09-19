/**
 * Trailing whitespace (spaces and tabs before the line ending).
 *
 * Pure line/text planning for Monaco edits. Does not touch EOL, indentation at
 * the start of a line, or filesystem Save. Empty lines that are only spaces/tabs
 * become empty lines (the newline stays).
 */

export type TrailingWhitespaceSpan = {
  /** 1-based line number. */
  lineNumber: number;
  /** 1-based column of the first trailing space/tab. */
  startColumn: number;
  /** 1-based exclusive end column (Monaco Range end). */
  endColumn: number;
};

const TRAILING_RE = /[ \t]+$/;

/** Trailing span on one line, or null when the line has none. */
export function trailingWhitespaceOnLine(
  lineContent: string,
): { startColumn: number; endColumn: number } | null {
  const match = TRAILING_RE.exec(lineContent);
  if (!match) {
    return null;
  }
  return {
    startColumn: match.index + 1,
    endColumn: lineContent.length + 1,
  };
}

/**
 * Collect every trailing span in a document.
 * `lineAt` is 1-based, matching Monaco `getLineContent`.
 */
export function collectTrailingWhitespaceSpans(
  lineCount: number,
  lineAt: (lineNumber: number) => string,
): TrailingWhitespaceSpan[] {
  const spans: TrailingWhitespaceSpan[] = [];
  for (let lineNumber = 1; lineNumber <= lineCount; lineNumber += 1) {
    const span = trailingWhitespaceOnLine(lineAt(lineNumber));
    if (span) {
      spans.push({ lineNumber, ...span });
    }
  }
  return spans;
}

/** Delete trailing runs from a plain string (LF or CRLF). Pure helper for tests. */
export function trimTrailingWhitespaceInText(text: string): string {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  // A final line ending splits off an empty last line, so the join keeps it.
  return text
    .split(/\r?\n/)
    .map((line) => line.replace(TRAILING_RE, ""))
    .join(eol);
}
