import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeMarkdownFile,
  MAX_ANALYZED_BYTES,
} from "../../../../src/bun/filesystem/scanning/noteAnalyzer";

// Intent: file-analysis metadata, link extraction, and byte-safe truncation.
describe("analyzeMarkdownFile", () => {
  test("extracts frontmatter and links; truncated reads never split a multi-byte character", async () => {
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
      expect(analyzed.documentLinks.map((link) => link.syntax)).toEqual(["wikilink", "wikilink"]);
      expect(analyzed.documentLinks[1]).toMatchObject({
        target: "reference",
        anchor: "overview",
        label: "the reference",
      });
    } finally {
      await rm(directory, { recursive: true, force: true });
    }

    const utf8Dir = await mkdtemp(join(tmpdir(), "editor-note-utf8-"));
    const wide = join(utf8Dir, "wide.md");
    try {
      await writeFile(wide, "\u{1F600}".repeat(MAX_ANALYZED_BYTES));
      const truncated = await analyzeMarkdownFile(wide);
      expect(truncated.content).not.toContain("\uFFFD");
    } finally {
      await rm(utf8Dir, { recursive: true, force: true });
    }
  }, 30_000);
});
