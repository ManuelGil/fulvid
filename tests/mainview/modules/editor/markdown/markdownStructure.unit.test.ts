import { describe, expect, test } from "bun:test";

import {
  findMarkdownHeading,
  parseMarkdownStructure,
} from "../../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";

// Intent: keep outline parsing aligned with heading, fence, and frontmatter rules.
// Growth boundary: add cases only for a new Markdown structural form.
describe("Markdown structure", () => {
  test("parses outline forms and resolves ATX and Setext anchors", () => {
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
  });
});

// Intent: a `-` or `=` run is a setext underline only under paragraph text.
// Growth boundary: add a case only for a block form that changes that answer.
describe("Markdown structure setext boundaries", () => {
  test("does not read a thematic break after a non-paragraph block as a heading", () => {
    const headings = (content: string): string[] =>
      parseMarkdownStructure(content).headings.map(
        (heading) => `h${heading.depth}:${heading.text}`,
      );

    expect(headings("# Real\n\n- item\n---\n\n## After\n")).toEqual(["h1:Real", "h2:After"]);
    expect(headings("> quote\n---\n\n## After\n")).toEqual(["h2:After"]);
    expect(headings("1. item\n---\n\n## After\n")).toEqual(["h2:After"]);
    expect(headings("para\n\n    code\n---\n\n## After\n")).toEqual(["h2:After"]);
    expect(headings("| a | b |\n|:--|--:|\n| 1 | 2 |\n---\n\n## After\n")).toEqual(["h2:After"]);

    // Paragraph text still underlines, including a line that merely starts with a hyphen.
    expect(headings("Title\n---\n\n## After\n")).toEqual(["h2:Title", "h2:After"]);
    expect(headings("-notadash\n---\n\n## After\n")).toEqual(["h2:-notadash", "h2:After"]);
    expect(headings("a - b\n---\n")).toEqual(["h2:a - b"]);
  });

  test("reports a multi-line setext heading at the first line of its paragraph", () => {
    const structure = parseMarkdownStructure("alpha\nbeta\n---\n\n## After\n");

    expect(structure.headings[0]).toMatchObject({
      lineNumber: 1,
      depth: 2,
      text: "alpha beta",
      anchor: "alpha-beta",
    });
    expect(structure.headings[1]?.lineNumber).toBe(5);
    expect(findMarkdownHeading("alpha\nbeta\n---\n", "alpha-beta")?.lineNumber).toBe(1);
  });
});
