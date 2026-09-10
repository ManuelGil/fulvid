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
