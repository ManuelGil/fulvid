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

function queryFlag(value: unknown): boolean {
  return value === "1" || value === "true";
}

function parseFileType(value: unknown): SearchFileType {
  return value === "md" || value === "markdown" || value === "mdx" ? value : "all";
}

function parseSort(value: unknown): SearchSort {
  return value === "matches" ? "matches" : "path";
}

function parseStrategy(query: LocationQuery | LocationQueryRaw): SearchStrategyId {
  if (isSearchStrategyId(query.mode)) {
    return query.mode;
  }
  return queryFlag(query.regex) ? "regex" : "literal";
}

export function parseSearchOptions(query: LocationQuery | LocationQueryRaw): SearchOptions {
  const strategy = parseStrategy(query);
  return {
    strategy,
    caseSensitive: queryFlag(query.case),
    wholeWord: searchStrategyUsesWholeWord(strategy) && queryFlag(query.word),
    fileType: parseFileType(query.type),
    sort: parseSort(query.sort),
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
    sort: next.sort === "matches" ? "matches" : undefined,
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
