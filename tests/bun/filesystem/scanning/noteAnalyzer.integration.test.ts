import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  analyzeMarkdownFile,
  MAX_ANALYZED_BYTES,
} from "../../../../src/bun/filesystem/scanning/noteAnalyzer";

// Intent: lock file-analysis metadata, link extraction, and byte-safe truncation.
// Growth boundary: add cases only for new grammar or encoding limits.
describe("analyzeMarkdownFile", () => {
  test("extracts frontmatter and document links from a Markdown file", async () => {
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
  });
});

describe("analysis limits", () => {
  test("a truncated read never splits a multi-byte character", async () => {
    const directory = await mkdtemp(join(tmpdir(), "editor-note-utf8-"));
    const filePath = join(directory, "wide.md");

    try {
      // Four-byte characters that will not align with the byte cap.
      await writeFile(filePath, "\u{1F600}".repeat(MAX_ANALYZED_BYTES));

      const analyzed = await analyzeMarkdownFile(filePath);
      expect(analyzed.content).not.toContain("\uFFFD");
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 30_000);
});
