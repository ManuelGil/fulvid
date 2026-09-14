import { describe, expect, test } from "bun:test";

import { parseSearchOptions } from "../../../../src/mainview/modules/search/searchOptions.ts";
import {
  SEARCH_STRATEGY_IDS,
  isSearchStrategyId,
  resolveSearchStrategy,
  searchQueryIssue,
} from "../../../../src/mainview/modules/search/searchStrategies.ts";

// Intent: Global Search is literal/regex content retrieval only.
// Identity matching belongs to Quick Open; removed strategies must not remain selectable.
describe("search strategies", () => {
  test("exposes only literal and regex; unknown modes fall back safely", () => {
    expect([...SEARCH_STRATEGY_IDS]).toEqual(["literal", "regex"]);
    expect(isSearchStrategyId("fuzzy")).toBe(false);
    expect(isSearchStrategyId("path")).toBe(false);
    expect(isSearchStrategyId("words")).toBe(false);
    expect(resolveSearchStrategy({ strategy: "fuzzy" as never })).toBe("literal");
    expect(parseSearchOptions({ mode: "proximity" }).strategy).toBe("literal");
    expect(parseSearchOptions({ mode: "pattern" }).strategy).toBe("literal");
    expect(parseSearchOptions({ mode: "regex" }).strategy).toBe("regex");
    expect(parseSearchOptions({ regex: "1" }).strategy).toBe("regex");
    expect(searchQueryIssue("(unclosed", { strategy: "regex" })).toBe("invalidRegex");
    expect(searchQueryIssue("a".repeat(200), { strategy: "regex" })).toBe("tooExpensive");
  });
});
