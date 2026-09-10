/**
 * Global Search matching strategies over scanned note text.
 *
 * Retrieval only: does not open buffers, rewrite links, or implement Monaco
 * find (`Ctrl/Cmd+F`) or Find References (`Shift+F12`). URL `strategy` wins;
 * legacy `regex: true` still maps to the regex strategy.
 *
 * Strategies: literal, regex, fuzzy, words, boolean, proximity, pattern, path.
 * Hit and query shapes live here because matching produces them.
 */
import { parseDocumentLinks } from "../document/links/documentLink";
import { isMarkdownListLine } from "../editor/markdown/markdownEnter";
import { parseMarkdownStructure } from "../editor/markdown/markdownStructure";
import type { ScannedNote } from "../workspace/filesystem/workspaceTypes";

export type SearchStrategyId =
  "literal" | "regex" | "fuzzy" | "words" | "boolean" | "proximity" | "pattern" | "path";

export type SearchBooleanMode = "and" | "or";
export type SearchPatternKind = "heading" | "link" | "wikilink" | "frontmatter" | "fence" | "list";
export type SearchMatchKind = SearchPatternKind | "content" | "path";

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
  regex?: boolean;
  booleanMode?: SearchBooleanMode;
  proximity?: number;
  patternKind?: SearchPatternKind;
};

export type SearchSnippetPart = {
  text: string;
  match: boolean;
};

export type SearchQueryIssue = "invalidRegex" | "invalidPattern" | "tooExpensive" | "emptyQuery";

export type SearchRun = {
  hits: SearchHit[];
  issue: SearchQueryIssue | null;
};

export const SEARCH_STRATEGY_IDS = [
  "literal",
  "regex",
  "fuzzy",
  "words",
  "boolean",
  "proximity",
  "pattern",
  "path",
] as const satisfies readonly SearchStrategyId[];

export const DEFAULT_PROXIMITY = 8;
const MAX_REGEX_LENGTH = 120;
const MAX_STRATEGY_STEPS = 40_000;
const MAX_FUZZY_DISTANCE = 2;
const MIN_FUZZY_TERM = 2;
const MAX_PROXIMITY = 32;
const FRONTMATTER_KEY_RE = /^([A-Za-z0-9_-]+)\s*:\s*(.*)$/;

export type SearchStrategyLimits = {
  maxPerDocument: number;
  maxCollected: number;
};

export type SearchStrategyResult = SearchRun;

type Finder = (text: string, from: number) => { index: number; length: number } | null;

type Budget = {
  remaining: number;
};

type ContentLine = {
  text: string;
  offset: number;
};

function createBudget(): Budget {
  return { remaining: MAX_STRATEGY_STEPS };
}

function spend(budget: Budget, cost = 1): boolean {
  budget.remaining -= cost;
  return budget.remaining > 0;
}

export function isSearchStrategyId(value: unknown): value is SearchStrategyId {
  return SEARCH_STRATEGY_IDS.includes(value as SearchStrategyId);
}

export function resolveSearchStrategy(options: SearchQueryOptions = {}): SearchStrategyId {
  if (options.strategy && isSearchStrategyId(options.strategy)) {
    return options.strategy;
  }
  return options.regex ? "regex" : "literal";
}

export function searchStrategyUsesScore(strategy: SearchStrategyId): boolean {
  return strategy === "fuzzy" || strategy === "path";
}

export function searchStrategyUsesWholeWord(strategy: SearchStrategyId): boolean {
  return strategy === "literal";
}

export function searchStrategyUsesMatchCountSort(strategy: SearchStrategyId): boolean {
  return strategy !== "path";
}

export function splitSearchTerms(query: string): string[] {
  return query
    .trim()
    .split(/\s+/)
    .map((term) => term.trim())
    .filter(Boolean);
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
  if (strategy === "regex") {
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
  if (strategy === "fuzzy") {
    const terms = splitSearchTerms(needle);
    if (terms.length === 0 || terms.some((term) => term.length < MIN_FUZZY_TERM)) {
      return "invalidPattern";
    }
    return null;
  }
  if (strategy === "proximity" && splitSearchTerms(needle).length < 2) {
    return "invalidPattern";
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
  if (options.wholeWord || resolveSearchStrategy(options) === "words") {
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
  return compileLiteralFinder(query, {
    ...options,
    wholeWord: options.wholeWord || strategy === "words",
  });
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
  extras: { score?: number; kind?: SearchMatchKind } = {},
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
    matches.push(createSearchMatch(content, found.index, found.length, extras));
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

function tokenize(content: string): Array<{ text: string; index: number }> {
  const tokens: Array<{ text: string; index: number }> = [];
  const pattern = /[\p{L}\p{N}_]+/gu;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(content)) !== null) {
    tokens.push({ text: match[0], index: match.index });
  }
  return tokens;
}

function fuzzyDistanceLimit(termLength: number): number {
  return termLength >= 3 ? MAX_FUZZY_DISTANCE : 0;
}

function editDistance(left: string, right: string, max: number): number {
  if (Math.abs(left.length - right.length) > max) {
    return max + 1;
  }
  const rows = left.length + 1;
  const cols = right.length + 1;
  const previous = Array.from({ length: cols }, (_, index) => index);
  const current = Array.from({ length: cols }, () => 0);
  for (let i = 1; i < rows; i += 1) {
    current[0] = i;
    let rowMin = current[0];
    for (let j = 1; j < cols; j += 1) {
      const cost = left[i - 1] === right[j - 1] ? 0 : 1;
      current[j] = Math.min(
        (previous[j] ?? max) + 1,
        (current[j - 1] ?? max) + 1,
        (previous[j - 1] ?? max) + cost,
      );
      rowMin = Math.min(rowMin, current[j] ?? max);
    }
    if (rowMin > max) {
      return max + 1;
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length] ?? max + 1;
}

function fuzzyScore(token: string, query: string): number | null {
  if (token === query) {
    return 1;
  }
  if (token.startsWith(query) || query.startsWith(token)) {
    return 0.85;
  }
  if (token.includes(query)) {
    return 0.7;
  }
  const maxDistance = fuzzyDistanceLimit(query.length);
  if (maxDistance === 0) {
    return null;
  }
  const distance = editDistance(token, query, maxDistance);
  if (distance > maxDistance) {
    return null;
  }
  return Math.max(0.2, 1 - distance / Math.max(token.length, query.length));
}

function splitContentLines(content: string): ContentLine[] {
  const lines: ContentLine[] = [];
  let offset = 0;
  const parts = content.split(/\r?\n/);
  for (let index = 0; index < parts.length; index += 1) {
    const text = parts[index] ?? "";
    lines.push({ text, offset });
    offset += text.length;
    if (index < parts.length - 1) {
      offset += content.startsWith("\r\n", offset) ? 2 : 1;
    }
  }
  return lines;
}

function containsNormalized(haystack: string, needle: string, caseSensitive: boolean): boolean {
  return normalize(haystack, caseSensitive).includes(normalize(needle, caseSensitive));
}

function proximityWindow(options: SearchQueryOptions): number {
  const value = options.proximity ?? DEFAULT_PROXIMITY;
  return Math.min(MAX_PROXIMITY, Math.max(2, Math.round(value)));
}

function searchBoolean(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions,
  limits: SearchStrategyLimits,
  budget: Budget,
): SearchStrategyResult {
  const terms = splitSearchTerms(query);
  const mode = options.booleanMode === "or" ? "or" : "and";
  const hits: SearchHit[] = [];
  for (const note of notes) {
    const content = note.content ?? "";
    const termMatches: SearchMatch[][] = [];
    for (const term of terms) {
      const compiled = compileLiteralFinder(term, { ...options, wholeWord: false });
      if (!compiled.ok) {
        return { hits: [], issue: compiled.issue };
      }
      const collected = collectWithFinder(content, compiled.find, budget, limits.maxPerDocument);
      if (collected === "tooExpensive") {
        return { hits, issue: "tooExpensive" };
      }
      termMatches.push(collected);
    }
    const present = termMatches.filter((matches) => matches.length > 0);
    if (mode === "and" ? present.length !== terms.length : present.length === 0) {
      continue;
    }
    const merged = orderMatches((mode === "and" ? termMatches : present).flat()).slice(
      0,
      limits.maxPerDocument,
    );
    if (!appendHits(hits, note, merged, limits.maxCollected)) {
      break;
    }
  }
  return { hits, issue: null };
}

function searchProximity(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions,
  limits: SearchStrategyLimits,
  budget: Budget,
): SearchStrategyResult {
  const terms = splitSearchTerms(query).map((term) =>
    normalize(term, Boolean(options.caseSensitive)),
  );
  if (terms.length < 2) {
    return { hits: [], issue: "invalidPattern" };
  }
  const windowSize = proximityWindow(options);
  const hits: SearchHit[] = [];
  for (const note of notes) {
    if (!spend(budget, 4)) {
      return { hits, issue: "tooExpensive" };
    }
    const content = note.content ?? "";
    const tokens = tokenize(content);
    const matches: SearchMatch[] = [];
    let index = 0;
    while (index < tokens.length && matches.length < limits.maxPerDocument) {
      if (!spend(budget)) {
        return { hits, issue: "tooExpensive" };
      }
      const slice = tokens.slice(index, index + windowSize);
      const remaining = [...terms];
      const used: Array<{ text: string; index: number }> = [];
      for (const token of slice) {
        const foundAt = remaining.findIndex(
          (term) => normalize(token.text, Boolean(options.caseSensitive)) === term,
        );
        if (foundAt < 0) {
          continue;
        }
        remaining.splice(foundAt, 1);
        used.push(token);
        if (remaining.length === 0) {
          used.sort((left, right) => left.index - right.index);
          const first = used[0];
          const last = used[used.length - 1];
          const length = first && last ? last.index + last.text.length - first.index : 0;
          if (
            first &&
            last &&
            !matches.some((match) => match.offset === first.index && match.length === length)
          ) {
            matches.push(
              createSearchMatch(content, first.index, length, {
                kind: "content",
              }),
            );
          }
          break;
        }
      }
      index += 1;
    }
    if (!appendHits(hits, note, matches, limits.maxCollected)) {
      break;
    }
  }
  return { hits, issue: null };
}

function searchFuzzy(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions,
  limits: SearchStrategyLimits,
  budget: Budget,
): SearchStrategyResult {
  const terms = splitSearchTerms(query).map((term) =>
    normalize(term, Boolean(options.caseSensitive)),
  );
  if (terms.length === 0 || terms.some((term) => term.length < MIN_FUZZY_TERM)) {
    return { hits: [], issue: "invalidPattern" };
  }
  const hits: SearchHit[] = [];
  for (const note of notes) {
    if (!spend(budget, 4)) {
      return { hits, issue: "tooExpensive" };
    }
    const content = note.content ?? "";
    const matches: SearchMatch[] = [];
    const matchedTerms = new Set<string>();
    for (const token of tokenize(content)) {
      if (!spend(budget, 2)) {
        return { hits, issue: "tooExpensive" };
      }
      const normalized = normalize(token.text, Boolean(options.caseSensitive));
      let best: number | null = null;
      for (const term of terms) {
        const score = fuzzyScore(normalized, term);
        if (score === null) {
          continue;
        }
        matchedTerms.add(term);
        best = best === null ? score : Math.max(best, score);
      }
      if (best !== null && matches.length < limits.maxPerDocument) {
        matches.push(
          createSearchMatch(content, token.index, token.text.length, {
            kind: "content",
            score: best,
          }),
        );
      }
      if (matches.length >= limits.maxPerDocument && matchedTerms.size === terms.length) {
        break;
      }
    }
    if (matchedTerms.size !== terms.length) {
      continue;
    }
    if (!appendHits(hits, note, matches, limits.maxCollected)) {
      break;
    }
  }
  return { hits, issue: null };
}

function pathFieldScore(field: string, query: string, caseSensitive: boolean): number | null {
  const haystack = normalize(field, caseSensitive);
  const needle = normalize(query, caseSensitive);
  if (!needle || !haystack.includes(needle)) {
    return null;
  }
  if (haystack === needle) {
    return 1;
  }
  const base = haystack.replace(/\.(md|markdown|mdx)$/i, "");
  if (base === needle) {
    return 0.95;
  }
  if (base.startsWith(needle) || haystack.startsWith(needle)) {
    return 0.88;
  }
  const segments = haystack.split(/[/\\]/);
  if (
    segments.some((segment) => {
      const stem = segment.replace(/\.(md|markdown|mdx)$/i, "");
      return segment === needle || stem === needle;
    })
  ) {
    return 0.82;
  }
  return 0.6;
}

function searchPath(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions,
  limits: SearchStrategyLimits,
  budget: Budget,
): SearchStrategyResult {
  const needle = query.trim();
  const hits: SearchHit[] = [];
  for (const note of notes) {
    if (hits.length >= limits.maxCollected) {
      break;
    }
    if (!spend(budget)) {
      return { hits, issue: "tooExpensive" };
    }
    const fields = [note.name, note.title, note.path];
    let best: { field: string; score: number } | null = null;
    for (const field of fields) {
      const score = pathFieldScore(field, needle, Boolean(options.caseSensitive));
      if (score === null) {
        continue;
      }
      if (!best || score > best.score) {
        best = { field, score };
      }
    }
    if (!best) {
      continue;
    }
    hits.push({
      note,
      match: {
        offset: 0,
        length: needle.length,
        lineNumber: 1,
        column: 1,
        snippet: best.field,
        kind: "path",
        score: best.score,
      },
    });
  }
  return { hits, issue: null };
}

function isInsideFence(
  fences: readonly { startLine: number; endLine: number }[],
  lineNumber: number,
): boolean {
  return fences.some((fence) => lineNumber > fence.startLine && lineNumber < fence.endLine);
}

function searchPattern(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions,
  limits: SearchStrategyLimits,
  budget: Budget,
): SearchStrategyResult {
  const kind = options.patternKind ?? "heading";
  const needle = query.trim();
  const hits: SearchHit[] = [];
  for (const note of notes) {
    if (!spend(budget, 8)) {
      return { hits, issue: "tooExpensive" };
    }
    const content = note.content ?? "";
    const lines = splitContentLines(content);
    const structure = parseMarkdownStructure(content);
    const matches: SearchMatch[] = [];
    const take = (index: number, length: number, matchKind: SearchMatchKind): void => {
      if (matches.length < limits.maxPerDocument) {
        matches.push(createSearchMatch(content, index, length, { kind: matchKind }));
      }
    };

    if (kind === "heading") {
      for (const heading of structure.headings) {
        if (needle && !containsNormalized(heading.text, needle, Boolean(options.caseSensitive))) {
          continue;
        }
        const line = lines[heading.lineNumber - 1];
        if (!line) {
          continue;
        }
        take(line.offset, line.text.length, "heading");
      }
    } else if (kind === "fence") {
      for (const fence of structure.fences) {
        const line = lines[fence.startLine - 1];
        if (!line) {
          continue;
        }
        if (needle && !containsNormalized(line.text, needle, Boolean(options.caseSensitive))) {
          continue;
        }
        take(line.offset, line.text.length || 3, "fence");
      }
    } else if (kind === "frontmatter") {
      if (structure.frontmatterEndLine !== null) {
        for (let lineNumber = 2; lineNumber < structure.frontmatterEndLine; lineNumber += 1) {
          const line = lines[lineNumber - 1];
          if (!line) {
            continue;
          }
          const key = line.text.trim().match(FRONTMATTER_KEY_RE)?.[1];
          if (
            !key ||
            (needle && !containsNormalized(key, needle, Boolean(options.caseSensitive)))
          ) {
            continue;
          }
          const keyIndex = line.text.indexOf(key);
          take(line.offset + Math.max(0, keyIndex), key.length, "frontmatter");
        }
      }
    } else if (kind === "link" || kind === "wikilink") {
      for (const link of parseDocumentLinks(
        content,
        kind === "wikilink" ? "wikilink" : "markdown",
      )) {
        if (link.syntax !== (kind === "wikilink" ? "wikilink" : "markdown")) {
          continue;
        }
        const haystack = `${link.raw} ${link.target} ${link.label ?? ""}`;
        if (needle && !containsNormalized(haystack, needle, Boolean(options.caseSensitive))) {
          continue;
        }
        take(link.range.start, link.range.end - link.range.start, kind);
      }
    } else {
      lines.forEach((line, index) => {
        const lineNumber = index + 1;
        if (structure.frontmatterEndLine !== null && lineNumber <= structure.frontmatterEndLine) {
          return;
        }
        if (isInsideFence(structure.fences, lineNumber)) {
          return;
        }
        if (!isMarkdownListLine(line.text)) {
          return;
        }
        if (needle && !containsNormalized(line.text, needle, Boolean(options.caseSensitive))) {
          return;
        }
        take(line.offset, line.text.length, "list");
      });
    }

    if (!appendHits(hits, note, matches, limits.maxCollected)) {
      break;
    }
  }
  return { hits, issue: null };
}

function searchFinderStrategy(
  notes: readonly ScannedNote[],
  query: string,
  options: SearchQueryOptions,
  limits: SearchStrategyLimits,
  budget: Budget,
  kind: SearchMatchKind,
): SearchStrategyResult {
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
      { kind },
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
  const strategy = resolveSearchStrategy(options);
  if (strategy === "boolean") {
    return searchBoolean(notes, query, options, limits, budget);
  }
  if (strategy === "proximity") {
    return searchProximity(notes, query, options, limits, budget);
  }
  if (strategy === "fuzzy") {
    return searchFuzzy(notes, query, options, limits, budget);
  }
  if (strategy === "path") {
    return searchPath(notes, query, options, limits, budget);
  }
  if (strategy === "pattern") {
    return searchPattern(notes, query, options, limits, budget);
  }
  return searchFinderStrategy(notes, query, options, limits, budget, "content");
}

function highlightWithFinder(
  snippet: string,
  terms: readonly string[],
  options: SearchQueryOptions,
): Array<{ text: string; match: boolean }> {
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  while (cursor < snippet.length) {
    let next: { index: number; length: number } | null = null;
    for (const term of terms) {
      const compiled = compileSearchFinder(term, options);
      if (!compiled.ok) {
        continue;
      }
      const found = compiled.find(snippet, cursor);
      if (found && (next === null || found.index < next.index)) {
        next = found;
      }
    }
    if (!next || next.index < cursor) {
      parts.push({ text: snippet.slice(cursor), match: false });
      break;
    }
    if (next.index > cursor) {
      parts.push({ text: snippet.slice(cursor, next.index), match: false });
    }
    parts.push({ text: snippet.slice(next.index, next.index + next.length), match: true });
    cursor = next.index + Math.max(1, next.length);
  }
  return parts.filter((part) => part.text.length > 0);
}

function highlightFuzzySnippet(
  snippet: string,
  query: string,
  options: SearchQueryOptions,
): Array<{ text: string; match: boolean }> {
  const terms = splitSearchTerms(query).map((term) =>
    normalize(term, Boolean(options.caseSensitive)),
  );
  if (terms.length === 0) {
    return [{ text: snippet, match: false }];
  }
  const parts: Array<{ text: string; match: boolean }> = [];
  let cursor = 0;
  for (const token of tokenize(snippet)) {
    if (token.index > cursor) {
      parts.push({ text: snippet.slice(cursor, token.index), match: false });
    }
    const score = terms.reduce<number | null>((best, term) => {
      const next = fuzzyScore(normalize(token.text, Boolean(options.caseSensitive)), term);
      if (next === null) {
        return best;
      }
      return best === null ? next : Math.max(best, next);
    }, null);
    parts.push({ text: token.text, match: score !== null });
    cursor = token.index + token.text.length;
  }
  if (cursor < snippet.length) {
    parts.push({ text: snippet.slice(cursor), match: false });
  }
  return mergeHighlightParts(parts);
}

function mergeHighlightParts(
  parts: Array<{ text: string; match: boolean }>,
): Array<{ text: string; match: boolean }> {
  const merged: Array<{ text: string; match: boolean }> = [];
  for (const part of parts) {
    if (!part.text) {
      continue;
    }
    const last = merged[merged.length - 1];
    if (last && last.match === part.match) {
      last.text += part.text;
      continue;
    }
    merged.push({ ...part });
  }
  return merged;
}

export function highlightSearchSnippet(
  snippet: string,
  query: string,
  options: SearchQueryOptions = {},
): SearchSnippetPart[] {
  if (!snippet) {
    return [];
  }
  const strategy = resolveSearchStrategy(options);
  if (strategy === "fuzzy") {
    return highlightFuzzySnippet(snippet, query, options);
  }
  const terms =
    strategy === "boolean" || strategy === "proximity"
      ? splitSearchTerms(query)
      : [query.trim()].filter(Boolean);
  if (terms.length === 0) {
    return [{ text: snippet, match: false }];
  }
  return highlightWithFinder(snippet, terms, {
    ...options,
    strategy: strategy === "regex" ? "regex" : "literal",
    wholeWord: strategy === "words" || (strategy === "literal" && Boolean(options.wholeWord)),
  });
}
