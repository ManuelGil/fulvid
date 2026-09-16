/**
 * Search query options as URL state. Not a settings store: leaving Search
 * can drop them. Strategy implementations live in `searchStrategies.ts`.
 *
 * Unknown `mode` values fall back to literal. `regex=1` means the regex
 * strategy. Extra query keys are cleared when options are rewritten.
 */
import type { LocationQuery, LocationQueryRaw } from "vue-router";

import {
  isSearchStrategyId,
  searchStrategyUsesMatchCountSort,
  searchStrategyUsesWholeWord,
  type SearchStrategyId,
} from "./searchStrategies";

export type SearchFileType = "all" | "md" | "markdown" | "mdx";
export type SearchSort = "path" | "matches";

export type SearchOptions = {
  strategy: SearchStrategyId;
  caseSensitive: boolean;
  wholeWord: boolean;
  fileType: SearchFileType;
  sort: SearchSort;
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

export function parseSearchOptions(query: LocationQuery | LocationQueryRaw): SearchOptions {
  const strategy = parseStrategy(query);
  return {
    strategy,
    caseSensitive: queryFlag(query.case),
    wholeWord: searchStrategyUsesWholeWord(strategy) && queryFlag(query.word),
    fileType: parseFileType(queryValue(query.type)),
    sort: parseSort(queryValue(query.sort), strategy),
  };
}

export function countActiveSearchFilters(options: SearchOptions): number {
  return (
    Number(options.caseSensitive) +
    Number(options.wholeWord && searchStrategyUsesWholeWord(options.strategy)) +
    Number(options.fileType !== "all")
  );
}

export function searchOptionsQuery(
  currentQuery: LocationQueryRaw,
  patch: Partial<SearchOptions>,
): LocationQueryRaw {
  const next = { ...parseSearchOptions(currentQuery), ...patch };
  const sort =
    next.sort === "matches" && searchStrategyUsesMatchCountSort(next.strategy) ? "matches" : "path";
  return {
    ...currentQuery,
    mode: next.strategy === "literal" ? undefined : next.strategy,
    // Drop unused query keys when rewriting Search URL state.
    regex: undefined,
    bool: undefined,
    near: undefined,
    pattern: undefined,
    case: next.caseSensitive ? "1" : undefined,
    word: next.wholeWord && searchStrategyUsesWholeWord(next.strategy) ? "1" : undefined,
    type: next.fileType === "all" ? undefined : next.fileType,
    sort: sort === "path" ? undefined : sort,
  };
}

export function toSearchQueryOptions(options: SearchOptions): {
  strategy: SearchStrategyId;
  caseSensitive: boolean;
  wholeWord: boolean;
} {
  return {
    strategy: options.strategy,
    caseSensitive: options.caseSensitive,
    wholeWord: options.wholeWord && searchStrategyUsesWholeWord(options.strategy),
  };
}
