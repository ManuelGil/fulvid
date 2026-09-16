import { describe, expect, test } from "bun:test";

import {
  buildDocumentFromSelection,
  buildMarkdownTableOfContents,
  formatDocumentLink,
  relativeDocumentLinkPath,
} from "../../../../../src/mainview/modules/editor/markdown/markdownAuthoring.ts";
import {
  headingAnchor,
  parseMarkdownStructure,
} from "../../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";

// Intent: deterministic Markdown/wikilink strings for insert-link and TOC.
describe("markdown authoring", () => {
  test("formats links, selection bodies, and TOC for both linkModes", () => {
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

    expect(relativeDocumentLinkPath("docs/a.md", "docs/b.md")).toBe("./b.md");
    expect(relativeDocumentLinkPath("docs/a.md", "readme.md")).toBe("../readme.md");

    expect(
      buildDocumentFromSelection({
        selection: "Extracted paragraph.",
        linkMode: "markdown",
      }),
    ).toBe("Extracted paragraph.");
    expect(
      buildDocumentFromSelection({
        selection: "Keep trailing spaces  \n",
        sourcePath: "notes/source.md",
        sourceLabel: "Source",
        linkMode: "markdown",
      }),
    ).toBe("Keep trailing spaces  \n\n[Source](notes/source.md)\n");
    expect(
      buildDocumentFromSelection({
        selection: "Body",
        sourcePath: "notes/source.md",
        sourceLabel: "Source",
        linkMode: "wikilink",
      }),
    ).toBe("Body\n\n[[notes/source.md|Source]]\n");
    expect(
      buildDocumentFromSelection({
        selection: "Body",
        sourcePath: "notes/source.md",
        linkMode: "markdown",
      }),
    ).not.toMatch(/#L\d|#\d+:\d+/);

    const structure = parseMarkdownStructure(`# Title

## Overview

### Details

## Usage
`);
    const markdownToc = buildMarkdownTableOfContents(structure.headings, {
      linkMode: "markdown",
    });
    expect(markdownToc).toBe(
      [
        `- [Title](#${headingAnchor("Title")})`,
        `  - [Overview](#${headingAnchor("Overview")})`,
        `    - [Details](#${headingAnchor("Details")})`,
        `  - [Usage](#${headingAnchor("Usage")})`,
        "",
      ].join("\n"),
    );
    expect(markdownToc).not.toContain("{{");
    expect(buildMarkdownTableOfContents([], { linkMode: "markdown" })).toBe("");

    const notes = parseMarkdownStructure("## Notes\n").headings;
    expect(buildMarkdownTableOfContents(notes, { linkMode: "wikilink" })).toBe(
      `- [[#${headingAnchor("Notes")}|Notes]]\n`,
    );
  });
});
