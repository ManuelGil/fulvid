import { afterEach, describe, expect, test } from "bun:test";

import {
  parseDocumentLinks,
  resolveDocumentLink,
} from "../../../../../src/mainview/modules/document/links/documentLink";
import { setDocumentLinkSettings } from "../../../../../src/mainview/modules/document/links/linkSemantics";
import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function link(syntax: DocumentLink["syntax"], raw: string, target: string): DocumentLink {
  return {
    syntax,
    raw,
    target,
    range: { start: 0, end: raw.length },
  };
}

function note(
  path: string,
  documentLinks: DocumentLink[] = [],
  overrides: Partial<ScannedNote> = {},
): ScannedNote {
  const name = path.split("/").pop() ?? path;
  return {
    path,
    name,
    title: name.replace(/\.(md|markdown|mdx)$/i, ""),
    aliases: [],
    documentLinks,
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    tokens: 0,
    words: 0,
    ...overrides,
  };
}

afterEach(() => {
  setDocumentLinkSettings({
    linkMode: "markdown",
    resolution: "both",
  });
});

// Intent: protect active-syntax parsing and deterministic link resolution.
// Growth boundary: add cases only for new syntax, precedence, or code-span rules.
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

  test("resolves path-prefixed and mdx targets before title or alias", () => {
    const notes = [
      note("docs/Guide.mdx", [], { title: "Guide", aliases: ["handbook"] }),
      note("setup.markdown", [], { title: "Setup" }),
    ];

    expect(
      resolveDocumentLink(link("wikilink", "[[docs/Guide.mdx]]", "docs/Guide.mdx"), notes),
    ).toMatchObject({ path: "docs/Guide.mdx", reason: "exact-path" });
    expect(resolveDocumentLink(link("markdown", "[x](setup)", "setup"), notes)).toMatchObject({
      path: "setup.markdown",
      reason: "stem",
    });
    expect(resolveDocumentLink(link("wikilink", "[[handbook]]", "handbook"), notes)).toMatchObject({
      path: "docs/Guide.mdx",
      reason: "alias",
    });
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
