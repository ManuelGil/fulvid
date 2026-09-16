import { describe, expect, test } from "bun:test";

import { parseSearchOptions } from "../../../../src/mainview/modules/search/searchOptions.ts";
import {
  SEARCH_STRATEGY_IDS,
  isSearchStrategyId,
  looksCatastrophicRegex,
  resolveSearchStrategy,
  runSearchStrategy,
  searchQueryIssue,
} from "../../../../src/mainview/modules/search/searchStrategies.ts";

// Intent: Global Search is literal/regex content retrieval only.
// Identity matching belongs to Quick Open; removed strategies must not remain selectable.
describe("search strategies", () => {
  test("allows only literal/regex and refuses catastrophic patterns before matching", () => {
    expect([...SEARCH_STRATEGY_IDS]).toEqual(["literal", "regex"]);
    expect(isSearchStrategyId("fuzzy")).toBe(false);
    expect(isSearchStrategyId("path")).toBe(false);
    expect(resolveSearchStrategy({ strategy: "fuzzy" as never })).toBe("literal");
    expect(parseSearchOptions({ mode: "proximity" }).strategy).toBe("literal");
    expect(parseSearchOptions({ mode: "regex" }).strategy).toBe("regex");
    expect(searchQueryIssue("(unclosed", { strategy: "regex" })).toBe("invalidRegex");
    expect(searchQueryIssue("a".repeat(200), { strategy: "regex" })).toBe("tooExpensive");

    expect(looksCatastrophicRegex("(a+)+b")).toBe(true);
    expect(looksCatastrophicRegex("note|draft")).toBe(false);
    expect(searchQueryIssue("(a+)+$", { strategy: "regex" })).toBe("tooExpensive");
    expect(searchQueryIssue("heading", { strategy: "regex" })).toBe(null);

    const notes = [
      {
        path: "big.md",
        name: "big.md",
        title: "Big",
        aliases: [],
        documentLinks: [],
        tags: [],
        categories: [],
        projects: [],
        summary: "",
        words: 1,
        content: `${"a".repeat(5000)}b`,
      },
    ];
    const run = runSearchStrategy(
      notes,
      "(a+)+b",
      { strategy: "regex" },
      {
        maxPerDocument: 25,
        maxCollected: 500,
      },
    );
    expect(run.issue).toBe("tooExpensive");
    expect(run.hits).toEqual([]);
  });
});
