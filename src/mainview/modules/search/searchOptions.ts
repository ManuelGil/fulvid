/**
 * Search query options as URL state. Not a settings store: leaving Search
 * can drop them. Strategy implementations live in `searchStrategies.ts`.
 */
import type { LocationQuery, LocationQueryRaw } from "vue-router";

import {
  DEFAULT_PROXIMITY,
  isSearchStrategyId,
  searchStrategyUsesMatchCountSort,
  searchStrategyUsesScore,
  searchStrategyUsesWholeWord,
  type SearchBooleanMode,
  type SearchPatternKind,
  type SearchStrategyId,
} from "./searchStrategies";

export type SearchFileType = "all" | "md" | "markdown" | "mdx";
export type SearchSort = "path" | "matches" | "score";

export type SearchOptions = {
  strategy: SearchStrategyId;
  caseSensitive: boolean;
  wholeWord: boolean;
  fileType: SearchFileType;
  sort: SearchSort;
  booleanMode: SearchBooleanMode;
  proximity: number;
  patternKind: SearchPatternKind;
};

export const DEFAULT_SEARCH_OPTIONS: SearchOptions = {
  strategy: "literal",
  caseSensitive: false,
  wholeWord: false,
  fileType: "all",
  sort: "path",
  booleanMode: "and",
  proximity: DEFAULT_PROXIMITY,
  patternKind: "heading",
};

function queryValue(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function queryFlag(value: unknown): boolean {
  return value === "1" || value === "true";
}

function parseFileType(value: unknown): SearchFileType {
  return value === "md" || value === "markdown" || value === "mdx" ? value : "all";
}

function parseSort(value: unknown, strategy: SearchStrategyId): SearchSort {
  if (value === "score" && searchStrategyUsesScore(strategy)) {
    return "score";
  }
  if (value === "matches" && searchStrategyUsesMatchCountSort(strategy)) {
    return "matches";
  }
  return "path";
}

function parseStrategy(query: LocationQuery | LocationQueryRaw): SearchStrategyId {
  const mode = queryValue(query.mode);
  if (isSearchStrategyId(mode)) {
    return mode;
  }
  return queryFlag(query.regex) ? "regex" : "literal";
}

function parseBooleanMode(value: unknown): SearchBooleanMode {
  return value === "or" ? "or" : "and";
}

function parsePatternKind(value: unknown): SearchPatternKind {
  return value === "link" ||
    value === "wikilink" ||
    value === "frontmatter" ||
    value === "fence" ||
    value === "list"
    ? value
    : "heading";
}

function parseProximity(value: unknown): number {
  const parsed = Number(queryValue(value));
  if (!Number.isFinite(parsed)) {
    return DEFAULT_PROXIMITY;
  }
  return Math.min(32, Math.max(2, Math.round(parsed)));
}

export function parseSearchOptions(query: LocationQuery | LocationQueryRaw): SearchOptions {
  const strategy = parseStrategy(query);
  return {
    strategy,
    caseSensitive: queryFlag(query.case),
    wholeWord: searchStrategyUsesWholeWord(strategy) && queryFlag(query.word),
    fileType: parseFileType(queryValue(query.type)),
    sort: parseSort(queryValue(query.sort), strategy),
    booleanMode: parseBooleanMode(queryValue(query.bool)),
    proximity: parseProximity(query.near),
    patternKind: parsePatternKind(queryValue(query.pattern)),
  };
}

export function countActiveSearchFilters(options: SearchOptions): number {
  return (
    Number(options.caseSensitive) +
    Number(options.wholeWord && searchStrategyUsesWholeWord(options.strategy)) +
    Number(options.fileType !== "all") +
    Number(options.strategy === "boolean" && options.booleanMode === "or") +
    Number(options.strategy === "proximity" && options.proximity !== DEFAULT_PROXIMITY) +
    Number(options.strategy === "pattern" && options.patternKind !== "heading")
  );
}

export function searchOptionsQuery(
  currentQuery: LocationQueryRaw,
  patch: Partial<SearchOptions>,
): LocationQueryRaw {
  const next = { ...parseSearchOptions(currentQuery), ...patch };
  const sort =
    next.sort === "score" && searchStrategyUsesScore(next.strategy)
      ? "score"
      : next.sort === "matches" && searchStrategyUsesMatchCountSort(next.strategy)
        ? "matches"
        : "path";
  return {
    ...currentQuery,
    mode: next.strategy === "literal" ? undefined : next.strategy,
    regex: undefined,
    case: next.caseSensitive ? "1" : undefined,
    word: next.wholeWord && searchStrategyUsesWholeWord(next.strategy) ? "1" : undefined,
    type: next.fileType === "all" ? undefined : next.fileType,
    sort: sort === "path" ? undefined : sort,
    bool: next.strategy === "boolean" && next.booleanMode === "or" ? "or" : undefined,
    near:
      next.strategy === "proximity" && next.proximity !== DEFAULT_PROXIMITY
        ? String(next.proximity)
        : undefined,
    pattern:
      next.strategy === "pattern" && next.patternKind !== "heading" ? next.patternKind : undefined,
  };
}

export function toSearchQueryOptions(options: SearchOptions): {
  strategy: SearchStrategyId;
  caseSensitive: boolean;
  wholeWord: boolean;
  booleanMode?: SearchBooleanMode;
  proximity?: number;
  patternKind?: SearchPatternKind;
} {
  return {
    strategy: options.strategy,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord && searchStrategyUsesWholeWord(options.strategy),
    booleanMode: options.strategy === "boolean" ? options.booleanMode : undefined,
    proximity: options.strategy === "proximity" ? options.proximity : undefined,
    patternKind: options.strategy === "pattern" ? options.patternKind : undefined,
  };
}
