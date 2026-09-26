import { describe, expect, test } from "bun:test";

import {
  LINK_HOVER_PEEK_MAX_CHARS,
  LINK_HOVER_PEEK_MAX_LINES,
  linkHoverContentsMarkdown,
  linkHoverPeekAsHoverMarkdown,
  linkHoverSourcePeek,
  markdownBodyStartOffset,
} from "../../../../../src/mainview/modules/document/links/linkHoverSourcePeek.ts";

describe("linkHoverSourcePeek", () => {
  test("returns null for empty or whitespace-only bodies", () => {
    expect(linkHoverSourcePeek("")).toBeNull();
    expect(linkHoverSourcePeek("   \n\n  ")).toBeNull();
    expect(linkHoverSourcePeek("---\ntitle: x\n---\n\n")).toBeNull();
  });

  test("skips closed frontmatter and peeks body source", () => {
    const content = "---\ntitle: Secret\n---\n\n# Hello\n\nBody paragraph.\n";
    expect(markdownBodyStartOffset(content)).toBeGreaterThan(0);
    expect(linkHoverSourcePeek(content)).toBe("# Hello\n\nBody paragraph.");
  });

  test("starts at a heading line when provided", () => {
    const content = "# Intro\n\nLead.\n\n## Target\n\nUseful bit.\n";
    const peek = linkHoverSourcePeek(content, { startLineNumber: 5 });
    expect(peek).toBe("## Target\n\nUseful bit.");
    expect(peek).not.toContain("# Intro");
  });

  test("caps lines and characters without dumping large documents", () => {
    const lines = Array.from({ length: 40 }, (_, index) => `Line ${index + 1} ${"x".repeat(40)}`);
    const peek = linkHoverSourcePeek(lines.join("\n"));
    expect(peek).not.toBeNull();
    expect(peek!.split("\n").length).toBeLessThanOrEqual(LINK_HOVER_PEEK_MAX_LINES + 1);
    expect(peek!.replace(/\.\.\.$/, "").length).toBeLessThanOrEqual(LINK_HOVER_PEEK_MAX_CHARS);
    expect(peek).toContain("...");
  });

  test("unclosed frontmatter is not treated as body skip", () => {
    const content = "---\ntitle: open\n\n# Still visible\n";
    expect(markdownBodyStartOffset(content)).toBe(0);
    expect(linkHoverSourcePeek(content)).toContain("---");
    expect(linkHoverSourcePeek(content)).toContain("# Still visible");
  });

  test("hover markdown fences source so it stays inert text", () => {
    const peek = "# Title\n\nSee [link](other.md) and `code`.";
    const markdown = linkHoverPeekAsHoverMarkdown(peek);
    expect(markdown.startsWith("```markdown\n")).toBe(true);
    expect(markdown.endsWith("\n```")).toBe(true);
    expect(markdown).toContain(peek);
    const nested = linkHoverPeekAsHoverMarkdown("already has ``` inside");
    expect(nested.startsWith("````")).toBe(true);
  });
});

describe("linkHoverContentsMarkdown", () => {
  test("omits path when it repeats the identity title", () => {
    expect(
      linkHoverContentsMarkdown({
        title: "notes/alpha.md",
        path: "notes/alpha.md",
        peek: "# Alpha",
      }),
    ).toBe("**notes/alpha.md**\n\n```markdown\n# Alpha\n```");
  });

  test("keeps path when it adds information beyond the title", () => {
    expect(
      linkHoverContentsMarkdown({
        title: "Alpha",
        path: "notes/alpha.md",
        detailLines: ["Heading #section: Section"],
        peek: "## Section\n\nBody.",
      }),
    ).toBe(
      "**Alpha**\nnotes/alpha.md\nHeading #section: Section\n\n```markdown\n## Section\n\nBody.\n```",
    );
  });

  test("skips empty honesty lines", () => {
    expect(
      linkHoverContentsMarkdown({
        title: "Alpha",
        path: "notes/alpha.md",
        detailLines: ["", "Also matches: other.md"],
      }),
    ).toBe("**Alpha**\nnotes/alpha.md\nAlso matches: other.md");
  });
});
