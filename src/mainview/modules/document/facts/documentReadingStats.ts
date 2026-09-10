/**
 * Cheap reading metrics from the active document text.
 *
 * Word splitting matches the scanner (`\\s+`). Not a stored statistic and not
 * derived from Preview HTML.
 */
export const WORDS_PER_MINUTE = 200;

export type DocumentReadingKind = "empty" | "underOne" | "minutes";

export type DocumentReadingStats = {
  words: number;
  minutes: number;
  kind: DocumentReadingKind;
};

export function countDocumentWords(content: string): number {
  const trimmed = content.trim();
  if (!trimmed) {
    return 0;
  }
  return trimmed.split(/\s+/).length;
}

export function documentReadingStats(content: string): DocumentReadingStats {
  const words = countDocumentWords(content);
  if (words === 0) {
    return { words: 0, minutes: 0, kind: "empty" };
  }
  if (words < WORDS_PER_MINUTE) {
    return { words, minutes: 0, kind: "underOne" };
  }
  return {
    words,
    minutes: Math.max(1, Math.round(words / WORDS_PER_MINUTE)),
    kind: "minutes",
  };
}

export function readingStatisticsLabelKind(
  mode: "off" | "words" | "wordsAndTime",
  stats: DocumentReadingStats,
): "hidden" | "wordsOnly" | "readingUnderOne" | "reading" {
  if (mode === "off") {
    return "hidden";
  }
  if (mode === "words" || stats.kind === "empty") {
    return "wordsOnly";
  }
  if (stats.kind === "underOne") {
    return "readingUnderOne";
  }
  return "reading";
}
