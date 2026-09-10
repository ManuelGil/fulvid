import { describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import {
  renderMarkdownPreview,
  exportMarkdownPreviewDocument,
} from "../../../../../src/mainview/modules/editor/markdown/markdownPreview.ts";

function note(path: string, documentLinks: DocumentLink[] = []): ScannedNote {
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
  };
}

// Intent: keep preview inert while preserving safe internal links and anchors.
// Growth boundary: add cases only for new accepted syntax or security schemes.
describe("markdown preview", () => {
  test("escapes embedded HTML and keeps MDX inert", () => {
    const result = renderMarkdownPreview(
      "<script>alert('x')</script>\n\n<Component value={x} />\n\n<img onerror=alert(1)>",
      [],
      "markdown",
    );

    expect(result.html).toContain("&lt;script&gt;");
    expect(result.html).toContain("&lt;Component value={x} /&gt;");
    expect(result.html).toContain("&lt;img onerror=alert(1)&gt;");
    expect(result.html).not.toContain("<script>");
    expect(result.html).not.toContain("<img onerror");
  });

  test("uses the shared document resolver for Markdown and Wikilink targets", () => {
    const markdown = renderMarkdownPreview(
      "[Guide](docs/guide.mdx#start) [Missing](missing.md)",
      [note("docs/guide.mdx")],
      "markdown",
    );

    expect(markdown.html).toContain('data-document-path="docs/guide.mdx"');
    expect(markdown.html).toContain('data-document-anchor="start"');
    expect(markdown.html).not.toContain('data-document-path="missing.md"');

    const wikilink = renderMarkdownPreview(
      "See [[guide]]",
      [note("guide.md")],
      "wikilink",
      undefined,
      "note.md",
    );
    expect(wikilink.html).toContain('data-document-path="guide.md"');
  });

  test("refuses every executable and embedding URL scheme", () => {
    for (const target of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "vbscript:msgbox(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://example.com",
      "//example.com/protocol-relative",
    ]) {
      const result = renderMarkdownPreview(`[x](${target})`, [], "markdown");
      expect(result.html).not.toContain(target);
      expect(result.html).toContain('href="#"');
    }
  });

  test("images never produce a network request", () => {
    const result = renderMarkdownPreview(
      "![alt](https://evil.example/track.png)\n\n![svg](data:image/svg+xml,<svg onload=alert(1)>)",
      [],
      "markdown",
    );

    expect(result.html).not.toContain("<img");
    expect(result.html).not.toContain("evil.example");
    expect(result.html).toContain("markdown-preview__image");
  });

  test("a document link cannot escape the folder through the resolver", () => {
    const result = renderMarkdownPreview(
      "[out](../../../etc/passwd.md) [abs](/etc/passwd.md)",
      [note("docs/guide.mdx")],
      "markdown",
      undefined,
      "docs/current.md",
    );

    expect(result.html).not.toContain("data-document-path");
    expect(result.html).not.toContain("/etc/passwd");
  });

  test("HTML export wraps the same Preview representation in a complete document", () => {
    const source = [
      "# Start",
      "",
      "A **strong** paragraph with a [site](https://example.com).",
      "",
      "- item",
      "",
      "> quoted",
      "",
      "```ts",
      "const value = 1;",
      "```",
      "",
      "| A | B |",
      "| --- | --- |",
      "| 1 | 2 |",
      "",
      "<Component value={x} />",
      "",
      "<script>alert(1)</script>",
    ].join("\n");

    const preview = renderMarkdownPreview(
      source,
      [note("note.md")],
      "markdown",
      undefined,
      "note.md",
    );
    const exported = exportMarkdownPreviewDocument(source, [note("note.md")], "markdown", {
      title: "Note",
      sourcePath: "note.md",
    });

    expect(exported.html.startsWith("<!doctype html>\n<html>")).toBe(true);
    expect(exported.preview.html).toBe(preview.html);
    expect(exported.html).not.toContain("<script>");
    expect(exported.html).toContain("&lt;script&gt;");
    expect(exported.html).toContain("markdown-preview__inert");
    expect(exported.html).not.toContain("#document/");
    expect(exported.preview.hasUnsupportedMdx).toBe(true);

    const mdx = exportMarkdownPreviewDocument("# MDX\n\n<Note />\n", [], "markdown", {
      title: "Page",
    });
    expect(mdx.preview.hasUnsupportedMdx).toBe(true);
    expect(mdx.html).not.toContain("<Note");
    expect(mdx.html).toContain("markdown-preview__inert");
  });
});
