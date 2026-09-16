import { describe, expect, test } from "bun:test";

import {
  DEFAULT_README_TITLE,
  documentTemplateTitleFromParentPath,
  normalizeDocumentTemplateTitle,
  renderDocumentTemplate,
} from "../../../../../src/mainview/modules/editor/document/documentTemplates.ts";
import { renderMarkdownPreview } from "../../../../../src/mainview/modules/editor/markdown/markdownPreview.ts";

// Intent: one built-in README seed - title rules and inert interpolation.
// Growth boundary: do not add per-section body assertions.
describe("document templates", () => {
  test("README seed interpolates titles and keeps hostile names inert through Preview", () => {
    const blank = "";
    const withTitle = renderDocumentTemplate("readme", { title: "Docs" });
    const emptyTitle = renderDocumentTemplate("readme", { title: "   " });
    const omitted = renderDocumentTemplate("readme");

    expect(withTitle.startsWith("# Docs\n")).toBe(true);
    expect(withTitle).toContain("## Overview");
    expect(withTitle).not.toContain("{{");
    expect(withTitle.length).toBeGreaterThan(blank.length);
    expect(normalizeDocumentTemplateTitle(null)).toBe(DEFAULT_README_TITLE);
    expect(normalizeDocumentTemplateTitle("   ")).toBe(DEFAULT_README_TITLE);
    expect(emptyTitle.startsWith(`# ${DEFAULT_README_TITLE}\n`)).toBe(true);
    expect(omitted.startsWith(`# ${DEFAULT_README_TITLE}\n`)).toBe(true);
    expect(omitted).not.toBe(blank);

    expect(documentTemplateTitleFromParentPath("Docs", "Workspace")).toBe("Docs");
    expect(documentTemplateTitleFromParentPath("Projects/Fulvid", "Workspace")).toBe("Fulvid");
    expect(documentTemplateTitleFromParentPath("", "Workspace")).toBe("Workspace");
    expect(documentTemplateTitleFromParentPath("", null)).toBe(DEFAULT_README_TITLE);

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
