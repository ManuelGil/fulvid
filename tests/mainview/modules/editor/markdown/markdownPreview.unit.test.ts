import { describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import {
  countInlineMarkup,
  PREVIEW_INLINE_MARKUP_LIMIT,
  PREVIEW_RENDER_CHAR_LIMIT,
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

/**
 * marked's inline lexer is quadratic in the number of inline constructs. A
 * document inside the character cap can still hold tens of thousands of them,
 * which took over a minute to render and froze the renderer. These lock the
 * ceiling that bounds it, and the headroom that keeps prose out of it.
 */
describe("inline markup density", () => {
  const notes = [note("n0.md")];

  test("a document dense with inline markup renders inert instead of blocking", () => {
    for (const unit of ["[l](n0.md) ", "[l](https://e.example) ", "https://e.example ", "*x* "]) {
      const source = unit.repeat(Math.floor(PREVIEW_RENDER_CHAR_LIMIT / unit.length));

      const started = performance.now();
      const result = renderMarkdownPreview(source, notes, "markdown", undefined, "cur.md");
      const elapsed = performance.now() - started;

      expect(result.dense).toBe(true);
      expect(result.failed).toBe(false);
      // The text is still shown, and still escaped.
      expect(result.html.startsWith("<pre>")).toBe(true);
      expect(result.html).not.toContain("<a ");
      // The point of the ceiling: bounded work, not merely a flag.
      expect(elapsed).toBeLessThan(2_000);
    }
  });

  test("Export HTML is bounded by the same ceiling", () => {
    // Export reaches this renderer even when the Preview pane is closed.
    const source = "[l](n0.md) ".repeat(18_000);

    const started = performance.now();
    const exported = exportMarkdownPreviewDocument(source, notes, "markdown", {
      title: "dense",
      sourcePath: "cur.md",
    });

    expect(exported.preview.dense).toBe(true);
    expect(performance.now() - started).toBeLessThan(2_000);
    expect(exported.html).toContain("<pre>");
  });

  test("ordinary prose keeps rendering, with room to spare", () => {
    const prose =
      "# Heading\n\nSome **bold** and *italic* prose with a [link](n0.md) and `code`.\n\n".repeat(
        50,
      );

    const result = renderMarkdownPreview(prose, notes, "markdown", undefined, "cur.md");

    expect(result.dense).toBe(false);
    expect(result.html).toContain("<h1");
    expect(result.html).toContain("<strong>");
    // Real documents sit far below the ceiling; this asserts the margin.
    expect(countInlineMarkup(prose)).toBeLessThan(PREVIEW_INLINE_MARKUP_LIMIT / 2);
  });

  test("counting stops early instead of walking a hostile document twice", () => {
    const source = "*x* ".repeat(200_000);

    const started = performance.now();
    const count = countInlineMarkup(source);

    expect(count).toBeGreaterThan(PREVIEW_INLINE_MARKUP_LIMIT);
    expect(performance.now() - started).toBeLessThan(250);
  });
});
