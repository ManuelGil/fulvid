import { describe, expect, test } from "bun:test";

import {
  DEFAULT_README_TITLE,
  documentTemplateTitleFromParentPath,
  normalizeDocumentTemplateTitle,
  renderDocumentTemplate,
} from "../../../../../src/mainview/modules/editor/document/documentTemplates.ts";
import { renderMarkdownPreview } from "../../../../../src/mainview/modules/editor/markdown/markdownPreview.ts";

describe("document templates", () => {
  test("README seed interpolates title, stays substantial Markdown, and never equals blank", () => {
    const blank = "";
    const withTitle = renderDocumentTemplate("readme", { title: "Docs" });
    const fallback = renderDocumentTemplate("readme");

    expect(blank).toBe("");
    expect(withTitle.startsWith("# Docs\n")).toBe(true);
    expect(withTitle).toContain("## Overview");
    expect(withTitle).not.toContain("{{");
    expect(withTitle).not.toContain("}}");
    expect(withTitle.length).toBeGreaterThan(blank.length);
    expect(fallback.startsWith(`# ${DEFAULT_README_TITLE}\n`)).toBe(true);
    expect(fallback).not.toBe(blank);
  });

  test("missing or empty title falls back to README", () => {
    expect(normalizeDocumentTemplateTitle(null)).toBe(DEFAULT_README_TITLE);
    expect(normalizeDocumentTemplateTitle("   ")).toBe(DEFAULT_README_TITLE);
    expect(renderDocumentTemplate("readme", { title: "   " })).toContain(
      `# ${DEFAULT_README_TITLE}`,
    );
  });

  test("Explorer title uses the immediate parent folder, or workspace root at folder root", () => {
    expect(documentTemplateTitleFromParentPath("Docs", "Workspace")).toBe("Docs");
    expect(documentTemplateTitleFromParentPath("Projects/Fulvid", "Workspace")).toBe("Fulvid");
    expect(documentTemplateTitleFromParentPath("", "Workspace")).toBe("Workspace");
    expect(documentTemplateTitleFromParentPath("", null)).toBe(DEFAULT_README_TITLE);
  });

  test("hostile folder names stay inert through Mustache and Preview", () => {
    const hostile = `<script>alert(1)</script>`;
    const markdown = renderDocumentTemplate("readme", { title: hostile });
    expect(markdown).not.toContain("<script>");
    expect(markdown).toContain("&lt;script&gt;");
    expect(markdown).not.toContain("{{");

    const preview = renderMarkdownPreview(markdown, [], "markdown");
    expect(preview.html).not.toContain("<script>alert(1)</script>");
    expect(preview.html.toLowerCase()).not.toContain("javascript:");
  });
});
