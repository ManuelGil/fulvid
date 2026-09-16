/**
 * Global Search matching over scanned note text.
 *
 * Retrieval only: literal substring or bounded regular expression.
 * Does not open buffers, rewrite links, or implement Monaco find /
 * Find References. Reuses folder-scan `ScannedNote.content` (plus open
 * buffer overlays from the Search page). No second filesystem scan.
 *
 * `regex=1` maps to the regex strategy. Unknown `mode` values fall back to
 * literal.
 */
import type { ScannedNote } from "../workspace/filesystem/workspaceTypes";

export type SearchStrategyId = "literal" | "regex";

export type SearchMatchKind = "content";

export type SearchMatch = {
  offset: number;
  length: number;
  lineNumber: number;
  column: number;
  snippet: string;
  score?: number;
  kind?: SearchMatchKind;
};

export type SearchHit = {
  note: ScannedNote;
  match: SearchMatch;
};

export type SearchDocumentGroup = {
  note: ScannedNote;
  matches: SearchMatch[];
};

export type SearchQueryOptions = {
  strategy?: SearchStrategyId;
  caseSensitive?: boolean;
  wholeWord?: boolean;
  /** When true without `strategy`, treated as strategy "regex". */
  regex?: boolean;
};

export type SearchSnippetPart = {
  text: string;
  match: boolean;
};

export type SearchQueryIssue = "invalidRegex" | "tooExpensive";

export type SearchRun = {
  hits: SearchHit[];
  issue: SearchQueryIssue | null;
};

export const SEARCH_STRATEGY_IDS = [
  "literal",
  "regex",
] as const satisfies readonly SearchStrategyId[];

const MAX_REGEX_LENGTH = 120;
const MAX_STRATEGY_STEPS = 40_000;

export type SearchStrategyLimits = {
  maxPerDocument: number;
  maxCollected: number;
};

export type SearchStrategyResult = SearchRun;

type Finder = (text: string, from: number) => { index: number; length: number } | null;

type Budget = {
  remaining: number;
};

function createBudget(): Budget {
  return { remaining: MAX_STRATEGY_STEPS };
}

function spend(budget: Budget, cost = 1): boolean {
  budget.remaining -= cost;
  return budget.remaining > 0;
}

export function isSearchStrategyId(value: unknown): value is SearchStrategyId {
  return value === "literal" || value === "regex";
}

export function resolveSearchStrategy(options: SearchQueryOptions = {}): SearchStrategyId {
  if (options.strategy && isSearchStrategyId(options.strategy)) {
    return options.strategy;
  }
  return options.regex ? "regex" : "literal";
}

export function searchStrategyUsesWholeWord(strategy: SearchStrategyId): boolean {
  return strategy === "literal";
}

export function searchStrategyUsesMatchCountSort(_strategy: SearchStrategyId): boolean {
  return true;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(value: string, caseSensitive: boolean): string {
  return caseSensitive ? value : value.toLowerCase();
}

export function searchQueryIssue(
  query: string,
  options: SearchQueryOptions = {},
): SearchQueryIssue | null {
  const needle = query.trim();
  const strategy = resolveSearchStrategy(options);
  if (!needle) {
    return null;
  }
  if (strategy !== "regex") {
    return null;
  }
  if (needle.length > MAX_REGEX_LENGTH) {
    return "tooExpensive";
  }
  try {
    new RegExp(needle, "gu");
  } catch {
    return "invalidRegex";
  }
  return null;
}

function compileLiteralFinder(
  needle: string,
  options: SearchQueryOptions,
): { ok: true; find: Finder } | { ok: false; issue: SearchQueryIssue } {
  const term = needle.trim();
  if (!term) {
    return { ok: true, find: () => null };
  }
  if (options.wholeWord) {
    try {
      const pattern = new RegExp(
        `(?<![\\p{L}\\p{N}_])${escapeRegExp(term)}(?![\\p{L}\\p{N}_])`,
        `${options.caseSensitive ? "" : "i"}gu`,
      );
      return {
        ok: true,
        find: (text, from) => {
          pattern.lastIndex = from;
          const match = pattern.exec(text);
          return match && match[0].length > 0
            ? { index: match.index, length: match[0].length }
            : null;
        },
      };
    } catch {
      return { ok: false, issue: "invalidRegex" };
    }
  }
  const haystackNeedle = normalize(term, Boolean(options.caseSensitive));
  return {
    ok: true,
    find: (text, from) => {
      const index = normalize(text, Boolean(options.caseSensitive)).indexOf(haystackNeedle, from);
      return index < 0 ? null : { index, length: term.length };
    },
  };
}

function compileRegexFinder(
  needle: string,
  options: SearchQueryOptions,
): { ok: true; find: Finder } | { ok: false; issue: SearchQueryIssue } {
  const issue = searchQueryIssue(needle, { ...options, strategy: "regex" });
  if (issue) {
    return { ok: false, issue };
  }
  try {
    const pattern = new RegExp(needle.trim(), `${options.caseSensitive ? "" : "i"}gu`);
    return {
      ok: true,
      find: (text, from) => {
        pattern.lastIndex = from;
        const match = pattern.exec(text);
        if (!match || match[0].length === 0) {
          return null;
        }
        return { index: match.index, length: match[0].length };
      },
    };
  } catch {
    return { ok: false, issue: "invalidRegex" };
  }
}

export function compileSearchFinder(
  query: string,
  options: SearchQueryOptions = {},
): { ok: true; find: Finder } | { ok: false; issue: SearchQueryIssue } {
  const strategy = resolveSearchStrategy(options);
  if (strategy === "regex") {
    return compileRegexFinder(query, options);
  }
  return compileLiteralFinder(query, options);
}

export function positionAt(
  text: string,
  offset: number,
): {
  lineNumber: number;
  column: number;
} {
  const before = text.slice(0, offset);
  const lineBreak = before.lastIndexOf("\n");
  return {
    lineNumber: before.split("\n").length,
    column: offset - lineBreak,
  };
}

export function snippetAt(
  text: string,
  offset: number,
  matchLength: number,
  maxLength = 180,
): string {
  const matchEnd = Math.min(text.length, offset + Math.max(0, matchLength));
  const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
  const firstLineEndIndex = text.indexOf("\n", offset);
  const firstLineEnd = firstLineEndIndex < 0 ? text.length : firstLineEndIndex;
  const spansLines = matchEnd > firstLineEnd;
  const rawLine = spansLines
    ? text.slice(lineStart, matchEnd).replace(/\s+/g, " ")
    : text.slice(lineStart, firstLineEnd);
  const line = rawLine.trim();
  if (line.length <= maxLength) {
    return line;
  }

  const leadingWhitespace = rawLine.length - rawLine.trimStart().length;
  const matchIndex = Math.max(0, offset - lineStart - leadingWhitespace);
  const windowLength = Math.max(maxLength, matchLength);
  const contextBefore = Math.max(0, Math.floor((windowLength - matchLength) / 2));
  const start = Math.max(0, Math.min(matchIndex - contextBefore, line.length - windowLength));
  const end = Math.min(line.length, start + windowLength);
  return `${start > 0 ? "..." : ""}${line.slice(start, end)}${end < line.length ? "..." : ""}`;
}

export function createSearchMatch(
  content: string,
  index: number,
  length: number,
  extras: { score?: number; kind?: SearchMatchKind } = {},
): SearchMatch {
  return {
    offset: index,
    length,
    ...positionAt(content, index),
    snippet: snippetAt(content, index, length),
    ...extras,
  };
}

function collectWithFinder(
  content: string,
  find: Finder,
  budget: Budget,
  maxMatches: number,
): SearchMatch[] | "tooExpensive" {
  const matches: SearchMatch[] = [];
  let from = 0;
  while (matches.length < maxMatches && from <= content.length) {
    if (!spend(budget)) {
      return "tooExpensive";
    }
    const found = find(content, from);
    if (!found) {
      break;
    }
    matches.push(createSearchMatch(content, found.index, found.length, { kind: "content" }));
    from = found.index + Math.max(1, found.length);
  }
  return matches;
}

function orderMatches(matches: readonly SearchMatch[]): SearchMatch[] {
  const seen = new Set<string>();
  return [...matches]
    .sort((left, right) => left.offset - right.offset || left.length - right.length)
    .filter((match) => {
      const key = `${match.offset}:${match.length}`;
      if (seen.has(key)) {
        return false;
      }
      seen.add(key);
      return true;
    });
}

function appendHits(
  hits: SearchHit[],
  note: ScannedNote,
  matches: SearchMatch[],
  maxCollected: number,
): boolean {
  for (const match of orderMatches(matches)) {
    if (hits.length >= maxCollected) {
      return false;
    }
    hits.push({ note, match });
  }
  return hits.length < maxCollected;
}

export function runSearchStrategy(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions = {},
  limits: SearchStrategyLimits,
): SearchStrategyResult {
  const issue = searchQueryIssue(query, options);
  if (issue) {
    return { hits: [], issue };
  }
  if (!query.trim()) {
    return { hits: [], issue: null };
  }

  const budget = createBudget();
  const compiled = compileSearchFinder(query, options);
  if (!compiled.ok) {
    return { hits: [], issue: compiled.issue };
  }

  const hits: SearchHit[] = [];
  for (const note of notes) {
    const collected = collectWithFinder(
      note.content ?? "",
      compiled.find,
      budget,
      limits.maxPerDocument,
    );
    if (collected === "tooExpensive") {
      return { hits, issue: "tooExpensive" };
    }
    if (!appendHits(hits, note, collected, limits.maxCollected)) {
      break;
    }
  }
  return { hits, issue: null };
}

export function highlightSearchSnippet(
  snippet: string,
  query: string,
  options: SearchQueryOptions = {},
): SearchSnippetPart[] {
  if (!snippet) {
    return [];
  }
  const term = query.trim();
  if (!term) {
    return [{ text: snippet, match: false }];
  }
  const compiled = compileSearchFinder(term, options);
  if (!compiled.ok) {
    return [{ text: snippet, match: false }];
  }

  const parts: SearchSnippetPart[] = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    const found = compiled.find(snippet, cursor);
    if (!found || found.index < cursor) {
      parts.push({ text: snippet.slice(cursor), match: false });
      break;
    }
    if (found.index > cursor) {
      parts.push({ text: snippet.slice(cursor, found.index), match: false });
    }
    parts.push({
      text: snippet.slice(found.index, found.index + found.length),
      match: true,
    });
    cursor = found.index + Math.max(1, found.length);
  }
  return parts.filter((part) => part.text.length > 0);
}
