import { describe, expect, test } from "bun:test";

import { parseDocumentLinks } from "../../../../../src/mainview/modules/document/links/documentLink";

// Intent: protect active-syntax parsing. Resolution routes live in linkSemantics.
// Growth boundary: add cases only for new syntax or code-span rules.
describe("document links", () => {
  test("parses only the active syntax with anchors, aliases, and ranges", () => {
    const source = "See [[docs/Guide.mdx#Intro|Guide]] and [setup](docs/setup.markdown#start).";
    const wikilinks = parseDocumentLinks(source, "wikilink");

    expect(wikilinks).toHaveLength(1);
    expect(wikilinks[0]).toMatchObject({
      syntax: "wikilink",
      raw: "[[docs/Guide.mdx#Intro|Guide]]",
      target: "docs/Guide.mdx",
      anchor: "Intro",
      label: "Guide",
    });
    expect(source.slice(wikilinks[0].range.start, wikilinks[0].range.end)).toBe(wikilinks[0].raw);

    const markdownLinks = parseDocumentLinks(source, "markdown");
    expect(markdownLinks).toHaveLength(1);
    expect(markdownLinks[0]).toMatchObject({
      syntax: "markdown",
      raw: "[setup](docs/setup.markdown#start)",
      target: "docs/setup.markdown",
      anchor: "start",
      label: "setup",
    });
    expect(source.slice(markdownLinks[0].range.start, markdownLinks[0].range.end)).toBe(
      markdownLinks[0].raw,
    );
  });

  test("ignores links in frontmatter, inline code, and fenced code", () => {
    const source = `---
related: [[frontmatter]]
---

Use \`[inline](inline.md)\`.

\`\`\`md
[[fenced]]
[fenced](fenced.md)
\`\`\`

[real](real.md)`;

    expect(parseDocumentLinks(source, "markdown").map((item) => item.target)).toEqual(["real.md"]);
    expect(parseDocumentLinks(source, "wikilink").map((item) => item.target)).toEqual([]);
  });
});
