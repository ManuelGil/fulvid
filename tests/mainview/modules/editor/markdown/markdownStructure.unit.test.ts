import { describe, expect, test } from "bun:test";

import {
  findMarkdownHeading,
  parseMarkdownStructure,
} from "../../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";

// Intent: keep outline parsing aligned with heading, fence, frontmatter, and
// setext-vs-thematic-break rules.
// Growth boundary: add cases only for a new Markdown structural form.
describe("Markdown structure", () => {
  test("parses outline forms and keeps setext underlines paragraph-only", () => {
    const structure = parseMarkdownStructure(`---
title: Note
---

# Installation

\`\`\`md
# Not a heading
\`\`\`

Configuration
-------------
`);

    expect(structure.headings.map((heading) => heading.text)).toEqual([
      "Installation",
      "Configuration",
    ]);
    expect(structure.frontmatterEndLine).toBe(3);
    expect(structure.fences).toEqual([{ startLine: 7, endLine: 9 }]);

    const content = "# API Reference\n\nSetup\n=====\n";
    expect(findMarkdownHeading(content, "api-reference")?.lineNumber).toBe(1);
    expect(findMarkdownHeading(content, "Setup")?.lineNumber).toBe(3);

    const headings = (source: string): string[] =>
      parseMarkdownStructure(source).headings.map((heading) => `h${heading.depth}:${heading.text}`);

    // Representatives: list, quote, table (same non-paragraph rule).
    expect(headings("# Real\n\n- item\n---\n\n## After\n")).toEqual(["h1:Real", "h2:After"]);
    expect(headings("> quote\n---\n\n## After\n")).toEqual(["h2:After"]);
    expect(headings("| a | b |\n|:--|--:|\n| 1 | 2 |\n---\n\n## After\n")).toEqual(["h2:After"]);

    // Paragraph text still underlines, including a line that merely starts with a hyphen.
    expect(headings("Title\n---\n\n## After\n")).toEqual(["h2:Title", "h2:After"]);
    expect(headings("-notadash\n---\n\n## After\n")).toEqual(["h2:-notadash", "h2:After"]);

    const multiline = parseMarkdownStructure("alpha\nbeta\n---\n\n## After\n");
    expect(multiline.headings[0]).toMatchObject({
      lineNumber: 1,
      depth: 2,
      text: "alpha beta",
      anchor: "alpha-beta",
    });
    expect(multiline.headings[1]?.lineNumber).toBe(5);
    expect(findMarkdownHeading("alpha\nbeta\n---\n", "alpha-beta")?.lineNumber).toBe(1);
  });
});
