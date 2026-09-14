import { describe, expect, test } from "bun:test";

import { parseDocumentLinks } from "../../../../../src/mainview/modules/document/links/documentLink";

// Intent: active-syntax parsing; resolution lives in linkSemantics.
describe("document links", () => {
  test("parses only the active syntax and ignores frontmatter, inline code, and fences", () => {
    const source = "See [[docs/Guide.mdx#Intro|Guide]] and [setup](docs/setup.markdown#start).";
    const wikilinks = parseDocumentLinks(source, "wikilink");
    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0]).toMatchObject({
      syntax: "wikilink",
      target: "docs/Guide.mdx",
      anchor: "Intro",
      label: "Guide",
    });

    const markdownLinks = parseDocumentLinks(source, "markdown");
    expect(markdownLinks).toHaveLength(1);
    expect(markdownLinks[0]).toMatchObject({
      syntax: "markdown",
      target: "docs/setup.markdown",
      anchor: "start",
    });

    const masked = `---
related: [[frontmatter]]
---

Use \`[inline](inline.md)\`.

\`\`\`md
[[fenced]]
[fenced](fenced.md)
\`\`\`

[real](real.md)`;
    expect(parseDocumentLinks(masked, "markdown").map((item) => item.target)).toEqual(["real.md"]);
    expect(parseDocumentLinks(masked, "wikilink").map((item) => item.target)).toEqual([]);
  });
});
