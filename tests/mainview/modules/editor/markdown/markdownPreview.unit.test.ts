import { describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import {
  PREVIEW_BLOCK_MARKER_LIMIT,
  PREVIEW_INLINE_MARKUP_LIMIT,
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
    words: 0,
  };
}

// Intent: Preview is inert Markdown. MDX is never executed. Hostile schemes,
// attributes, and folder escapes must not become active behavior. Density is
// bounded so a crafted document cannot freeze the renderer. Export matches Preview.
describe("markdown preview", () => {
  test("preview and export stay inert under hostile input, density, and parity", () => {
    const html = renderMarkdownPreview(
      [
        "<script>alert('x')</script>",
        "<Component value={x} />",
        "<img onerror=alert(1)>",
        '<a href="javascript:alert(1)" onclick="alert(1)">x</a>',
        "{1 + 1}",
      ].join("\n\n"),
      [],
      "markdown",
    );
    expect(html.html).toContain("&lt;script&gt;");
    expect(html.html).not.toContain("<script>");
    expect(html.html).not.toContain("<img onerror");
    // Escaped text may still contain the word "onclick"; live attributes must not.
    expect(html.html).not.toMatch(/<[^>]*\son\w+=/i);
    // MDX/JSX must remain text, never a live component or expression.
    expect(html.html).toContain("&lt;Component");
    expect(html.hasUnsupportedMdx).toBe(true);

    for (const target of [
      "javascript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://example.com",
      "//evil.example/x",
    ]) {
      const result = renderMarkdownPreview(`[x](${target})`, [], "markdown");
      expect(result.html).not.toContain(target);
      // Non-document URLs are display-only: never tab stops or navigable anchors.
      expect(result.html).toContain('class="markdown-preview__external"');
      expect(result.html).not.toMatch(/<a\b[^>]*href=/i);
    }

    const images = renderMarkdownPreview(
      "![alt](https://evil.example/track.png)\n\n![svg](data:image/svg+xml,<svg onload=alert(1)>)",
      [],
      "markdown",
    );
    expect(images.html).not.toContain("<img");
    expect(images.html).not.toContain("evil.example");

    const mdx = renderMarkdownPreview(
      "import X from 'evil'\n\nexport const y = 1\n\n{1 + 1}\n\n{(() => 99)()}\n",
      [],
      "markdown",
    );
    expect(mdx.html).not.toMatch(/>\s*2\s*</);
    expect(mdx.html).not.toMatch(/>\s*99\s*</);
    expect(mdx.html).not.toContain("<script");
    expect(mdx.html).toContain("{1 + 1}");
    expect(mdx.html).toContain("import X from");

    const markdown = renderMarkdownPreview(
      "[Guide](docs/guide.mdx#start) [Missing](missing.md)",
      [note("docs/guide.mdx")],
      "markdown",
    );
    expect(markdown.html).toContain('data-document-path="docs/guide.mdx"');
    expect(markdown.html).toContain('data-document-anchor="start"');
    expect(markdown.html).not.toContain('data-document-path="missing.md"');

    // Both POSIX and Windows-looking escapes must stay unresolved.
    const escape = renderMarkdownPreview(
      "[out](../../../etc/passwd.md) [win](..\\..\\secret.md) [abs](/etc/passwd.md)",
      [note("docs/guide.mdx")],
      "markdown",
      undefined,
      "docs/current.md",
    );
    expect(escape.html).not.toContain("data-document-path");
    expect(escape.html).not.toContain("/etc/passwd");
    expect(escape.html).not.toContain("secret.md");

    const source =
      "# Start\n\nA **strong** paragraph.\n\n<Component value={x} />\n\n<script>alert(1)</script>";
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
    // Export is Preview wrapped as a document - not a second renderer that
    // could reintroduce active HTML.
    expect(exported.html.startsWith("<!doctype html>\n<html>")).toBe(true);
    expect(exported.preview.html).toBe(preview.html);
    expect(exported.html).not.toContain("<script>");
    expect(exported.html).toContain("&lt;script&gt;");
    expect(exported.preview.hasUnsupportedMdx).toBe(true);

    // Historical: marked's inline lexer is quadratic past the inline-markup ceiling.
    const notes = [note("n0.md")];
    const denseSource = "[l](n0.md) ".repeat(PREVIEW_INLINE_MARKUP_LIMIT + 1);

    const dense = renderMarkdownPreview(denseSource, notes, "markdown", undefined, "cur.md");
    expect(dense.dense).toBe(true);
    expect(dense.html.startsWith("<pre>")).toBe(true);
    expect(dense.html).not.toContain("<a ");

    const denseExport = exportMarkdownPreviewDocument(denseSource, notes, "markdown", {
      title: "dense",
      sourcePath: "cur.md",
    });
    expect(denseExport.preview.dense).toBe(true);
    expect(denseExport.html).toContain("<pre>");
  });
});

// Intent: heading identity in Preview comes from the heading's own source, and
// block-level ambiguity is bounded before marked runs.
// Growth boundary: add a case only for a new source of heading/marker ambiguity.
describe("markdown preview heading identity and block density", () => {
  test("annotates each heading from its own source line, including past frontmatter", () => {
    const html = renderMarkdownPreview(
      "> # Quoted\n\n- # Listed\n\n## After\n",
      [],
      "markdown",
    ).html;

    // Headings nested in a quote or a list are not in the line-based outline, so
    // they carry no anchor - and must not consume the next heading's identity.
    expect(html).toContain("<h1>Quoted</h1>");
    expect(html).toContain("<h1>Listed</h1>");
    expect(html).toContain('id="after"');
    expect(html).toContain('data-source-line="5"');

    const withFrontmatter = renderMarkdownPreview(
      "---\ntitle: x\n---\n\n# H\n",
      [],
      "markdown",
    ).html;
    expect(withFrontmatter).toContain('data-source-line="5"');
  });

  test("falls back to inert source when bare list markers make blocks ambiguous", () => {
    // "a\n-\n" repeated is ambiguous between a setext underline and a list item;
    // resolving it upstream is superlinear and froze the renderer.
    const overLimit = PREVIEW_BLOCK_MARKER_LIMIT + 1;
    const pathological = renderMarkdownPreview("a\n-\n".repeat(overLimit), [], "markdown");
    expect(pathological.dense).toBe(true);
    expect(pathological.html.startsWith("<pre>")).toBe(true);

    // Real bullets and real setext underlines keep rendering.
    expect(renderMarkdownPreview("- item one\n- item two\n".repeat(40), [], "markdown").dense).toBe(
      false,
    );
    expect(renderMarkdownPreview("Heading\n---\n\nbody\n\n".repeat(40), [], "markdown").dense).toBe(
      false,
    );
    // Fenced content is never ambiguous upstream, so it must not trip the bound.
    expect(
      renderMarkdownPreview("```\n" + "a\n-\n".repeat(overLimit) + "```\n", [], "markdown").dense,
    ).toBe(false);
  });
});
