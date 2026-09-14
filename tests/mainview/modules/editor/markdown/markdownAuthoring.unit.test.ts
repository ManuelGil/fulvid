import { describe, expect, test } from "bun:test";

import {
  buildMarkdownTableOfContents,
  formatDocumentLink,
  relativeDocumentLinkPath,
} from "../../../../../src/mainview/modules/editor/markdown/markdownAuthoring.ts";
import {
  headingAnchor,
  parseMarkdownStructure,
} from "../../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";

describe("markdown authoring", () => {
  test("formats document and heading links for markdown and wikilink modes", () => {
    expect(
      formatDocumentLink({
        label: "Docs",
        target: "./guide.md",
        linkMode: "markdown",
      }),
    ).toBe("[Docs](./guide.md)");

    expect(
      formatDocumentLink({
        label: "Setup",
        target: "./guide.md",
        anchor: "setup",
        linkMode: "markdown",
      }),
    ).toBe("[Setup](./guide.md#setup)");

    expect(
      formatDocumentLink({
        label: "Setup",
        target: "",
        anchor: "setup",
        linkMode: "markdown",
      }),
    ).toBe("[Setup](#setup)");

    expect(
      formatDocumentLink({
        label: "Guide",
        target: "guide.md",
        linkMode: "wikilink",
      }),
    ).toBe("[[guide.md|Guide]]");

    expect(
      formatDocumentLink({
        label: "Setup",
        target: "guide.md",
        anchor: "setup",
        linkMode: "wikilink",
      }),
    ).toBe("[[guide.md#setup|Setup]]");

    expect(
      formatDocumentLink({
        label: "Setup",
        target: "",
        anchor: "setup",
        linkMode: "wikilink",
      }),
    ).toBe("[[#setup|Setup]]");
  });

  test("sanitizes Markdown-sensitive characters in labels", () => {
    expect(
      formatDocumentLink({
        label: "A [weird] label",
        target: "./a.md",
        linkMode: "markdown",
      }),
    ).toBe("[A weird label](./a.md)");

    expect(
      formatDocumentLink({
        label: "A|B",
        target: "a.md",
        linkMode: "wikilink",
      }),
    ).toBe("[[a.md|AB]]");
  });

  test("relative paths climb from the source document directory", () => {
    expect(relativeDocumentLinkPath("docs/a.md", "docs/b.md")).toBe("./b.md");
    expect(relativeDocumentLinkPath("docs/a.md", "readme.md")).toBe("../readme.md");
  });

  test("TOC nests by heading depth using existing anchors", () => {
    const structure = parseMarkdownStructure(`# Title

## Overview

### Details

## Usage
`);
    const toc = buildMarkdownTableOfContents(structure.headings, { linkMode: "markdown" });
    expect(toc).toBe(
      [
        `- [Title](#${headingAnchor("Title")})`,
        `  - [Overview](#${headingAnchor("Overview")})`,
        `    - [Details](#${headingAnchor("Details")})`,
        `  - [Usage](#${headingAnchor("Usage")})`,
        "",
      ].join("\n"),
    );
    expect(toc).not.toContain("{{");
    expect(buildMarkdownTableOfContents([], { linkMode: "markdown" })).toBe("");
  });

  test("TOC uses wikilink fragments when linkMode is wikilink", () => {
    const headings = parseMarkdownStructure("## Notes\n").headings;
    expect(buildMarkdownTableOfContents(headings, { linkMode: "wikilink" })).toBe(
      `- [[#${headingAnchor("Notes")}|Notes]]\n`,
    );
  });
});
