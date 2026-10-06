import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeMarkdownFile,
  MAX_ANALYZED_BYTES,
} from "../../../../src/bun/filesystem/scanning/noteAnalyzer";
import { encodeDocumentText } from "../../../../src/bun/filesystem/io/documentText";

// Intent: file-analysis metadata and byte-safe truncation.
// Link shape/syntax contracts live in documentLink unit tests.
describe("analyzeMarkdownFile", () => {
  test("extracts frontmatter and truncated reads never split a multi-byte character", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editor-note-analyzer-"));
    const filePath = join(directory, "guide.md");

    try {
      await writeFile(
        filePath,
        [
          "---",
          "title: Getting Started",
          "aliases: [intro, handbook]",
          "tags: [editor, docs]",
          "categories: documentation",
          "projects: [editor]",
          "summary: A short guide",
          "---",
          "",
          "Read [[setup]] and [[reference#overview|the reference]].",
          "See [the guide](docs/guide.mdx#start).",
        ].join("\n"),
      );

      const analyzed = await analyzeMarkdownFile(filePath, "wikilink");
      expect(analyzed).toMatchObject({
        title: "Getting Started",
        aliases: ["intro", "handbook"],
        tags: ["editor", "docs"],
        categories: ["documentation"],
        projects: ["editor"],
        summary: "A short guide",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    // Regression: a BOM left in the analyzed text pushed the document one
    // character along, so frontmatter stopped matching and scan disagreed with
    // the editor about where the document starts.
    const bomDir = await mkdtemp(join(tmpdir(), "editor-note-bom-"));
    const bomPath = join(bomDir, "bom.md");
    try {
      await writeFile(bomPath, "\uFEFF---\ntitle: From Frontmatter\n---\n\n# Body\n", "utf8");
      const analyzed = await analyzeMarkdownFile(bomPath);
      expect(analyzed.title).toBe("From Frontmatter");
      expect(analyzed.content.startsWith("\uFEFF")).toBe(false);

      // A UTF-16 document is analysed too, so scan and editor agree about it
      // instead of the scan skipping what the editor can open.
      const utf16Path = join(bomDir, "utf16.md");
      await writeFile(utf16Path, encodeDocumentText(analyzed.content, "utf16le"));
      const utf16 = await analyzeMarkdownFile(utf16Path);
      expect(utf16.title).toBe("From Frontmatter");
      expect(utf16.content).toBe(analyzed.content);
    } finally {
      await rm(bomDir, { recursive: true, force: true });
    }

    const utf8Dir = await mkdtemp(join(tmpdir(), "editor-note-utf8-"));
    const wide = join(utf8Dir, "wide.md");
    try {
      // File just over the byte cap, cut mid 4-byte emoji - must not emit U+FFFD.
      const prefix = new Uint8Array(MAX_ANALYZED_BYTES - 1).fill(0x61);
      const emoji = new TextEncoder().encode("\u{1F600}");
      const payload = new Uint8Array(prefix.length + emoji.length);
      payload.set(prefix);
      payload.set(emoji, prefix.length);
      await writeFile(wide, payload);
      const truncated = await analyzeMarkdownFile(wide);
      expect(truncated.content).not.toContain("\uFFFD");
      expect(truncated.content.endsWith("a")).toBe(true);
    } finally {
      await rm(utf8Dir, { recursive: true, force: true });
    }
  });
});
