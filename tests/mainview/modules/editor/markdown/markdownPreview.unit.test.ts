import { describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";
import {
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
    words: 0,
  };
}

// Intent: Preview is inert Markdown. MDX is never executed. Hostile schemes,
// attributes, and folder escapes must not become active behavior. Density is
// bounded so a crafted document cannot freeze the renderer.
describe("markdown preview", () => {
  test("hostile HTML, schemes, and images stay inert", () => {
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
      "JaVaScRiPt:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "file:///etc/passwd",
      "http://example.com",
      "//evil.example/x",
    ]) {
      const result = renderMarkdownPreview(`[x](${target})`, [], "markdown");
      expect(result.html).not.toContain(target);
      expect(result.html).toContain('href="#"');
    }

    const images = renderMarkdownPreview(
      "![alt](https://evil.example/track.png)\n\n![svg](data:image/svg+xml,<svg onload=alert(1)>)",
      [],
      "markdown",
    );
    expect(images.html).not.toContain("<img");
    expect(images.html).not.toContain("evil.example");
  });

  // Security Harness: import / brace expressions must stay text (never evaluate).
  // Restored after develop consolidation dropped this case while preview.ts was unchanged.
  test("MDX import and brace expressions never evaluate", () => {
    const result = renderMarkdownPreview(
      "import X from 'evil'\n\nexport const y = 1\n\n{1 + 1}\n\n{(() => 99)()}\n",
      [],
      "markdown",
    );

    expect(result.html).not.toMatch(/>\s*2\s*</);
    expect(result.html).not.toMatch(/>\s*99\s*</);
    expect(result.html).not.toContain("<script");
    expect(result.html).toContain("{1 + 1}");
    expect(result.html).toContain("import X from");
  });

  test("document links resolve inside the folder and cannot escape it", () => {
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
  });

  test("HTML export reuses the same inert Preview representation", () => {
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
  });

  test("dense inline markup renders inert instead of blocking Preview or Export", () => {
    // Historical: marked's inline lexer is quadratic; a document under the
    // character cap could still freeze the UI for over a minute.
    const notes = [note("n0.md")];
    const source = "[l](n0.md) ".repeat(
      Math.floor(PREVIEW_RENDER_CHAR_LIMIT / "[l](n0.md) ".length),
    );

    const started = performance.now();
    const result = renderMarkdownPreview(source, notes, "markdown", undefined, "cur.md");
    expect(result.dense).toBe(true);
    expect(result.html.startsWith("<pre>")).toBe(true);
    expect(result.html).not.toContain("<a ");
    expect(performance.now() - started).toBeLessThan(2_000);

    const exported = exportMarkdownPreviewDocument(source, notes, "markdown", {
      title: "dense",
      sourcePath: "cur.md",
    });
    expect(exported.preview.dense).toBe(true);
    expect(exported.html).toContain("<pre>");
  });
});
