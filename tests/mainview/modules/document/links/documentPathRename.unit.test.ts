import { describe, expect, test } from "bun:test";

import { parseDocumentLinks } from "../../../../../src/mainview/modules/document/links/documentLink.ts";
import { planDocumentPathRename } from "../../../../../src/mainview/modules/document/links/documentPathRename.ts";
import { applyTextEdits } from "../../../../../src/mainview/modules/editor/markdown/markdownFormat.ts";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function note(path: string, content: string): ScannedNote {
  const name = path.split("/").pop() ?? path;
  const linkMode = content.includes("[[") ? "wikilink" : "markdown";
  return {
    path,
    name,
    title: name.replace(/\.(md|markdown|mdx)$/i, ""),
    aliases: [],
    documentLinks: parseDocumentLinks(content, linkMode === "wikilink" ? "wikilink" : "markdown"),
    tags: [],
    categories: [],
    projects: [],
    summary: "",
    words: 0,
    content,
  };
}

function applyPlan(
  contents: Map<string, string>,
  plan: ReturnType<typeof planDocumentPathRename>,
): Map<string, string> {
  const next = new Map<string, string>();
  for (const [path, content] of contents) {
    const live = path === plan.oldPath ? plan.newPath : path;
    next.set(live, content);
  }
  const byPath = new Map<string, typeof plan.edits>();
  for (const edit of plan.edits) {
    const list = byPath.get(edit.documentPath) ?? [];
    list.push(edit);
    byPath.set(edit.documentPath, list);
  }
  for (const [path, edits] of byPath) {
    const live = path === plan.oldPath ? plan.newPath : path;
    next.set(live, applyTextEdits(next.get(live) ?? "", edits));
  }
  return next;
}

// Intent: rename keeps resolvable inbound DocumentLinks continuous.
// Growth boundary: one case per independent rewrite rule, not per syntax quirk.
describe("document path rename", () => {
  test("rewrites markdown references with relative paths, fragments, and unrelated links untouched", () => {
    expect(
      planDocumentPathRename({
        oldPath: "a.md",
        newPath: "alpha.md",
        notes: [note("a.md", "# A\n"), note("b.md", "# B\n")],
        linkMode: "markdown",
      }).edits,
    ).toEqual([]);

    const target = note("docs/architecture.md", "# Architecture\n");
    const other = note("other.md", "# Other\n");
    const source = note(
      "notes/guide.md",
      [
        "See [Architecture](../docs/architecture.md).",
        "[section](../docs/architecture.md#overview)",
        "[other](../other.md)",
        "",
      ].join("\n"),
    );
    const plan = planDocumentPathRename({
      oldPath: "docs/architecture.md",
      newPath: "docs/design.md",
      notes: [target, other, source],
      linkMode: "markdown",
    });
    const next = applyPlan(
      new Map([
        ["docs/architecture.md", target.content!],
        ["other.md", other.content!],
        ["notes/guide.md", source.content!],
      ]),
      plan,
    );
    expect(next.get("notes/guide.md")).toBe(
      [
        "See [Architecture](../docs/design.md).",
        "[section](../docs/design.md#overview)",
        "[other](../other.md)",
        "",
      ].join("\n"),
    );
    expect(next.get("docs/design.md")).toBe("# Architecture\n");
  });

  test("rewrites wikilink path and stem targets while preserving labels and fragments", () => {
    const pathTarget = note("docs/architecture.md", "# Architecture\n\n## Overview\n");
    const pathSource = note(
      "notes/guide.md",
      "See [[../docs/architecture.md#overview|Architecture]].\n",
    );
    const pathPlan = planDocumentPathRename({
      oldPath: "docs/architecture.md",
      newPath: "docs/design.md",
      notes: [pathTarget, pathSource],
      linkMode: "wikilink",
    });
    expect(
      applyPlan(
        new Map([
          ["docs/architecture.md", pathTarget.content!],
          ["notes/guide.md", pathSource.content!],
        ]),
        pathPlan,
      ).get("notes/guide.md"),
    ).toBe("See [[../docs/design.md#overview|Architecture]].\n");

    const stemTarget = note("architecture.md", "# Architecture\n");
    const stemSource = note("guide.md", "See [[architecture]].\n");
    const stemPlan = planDocumentPathRename({
      oldPath: "architecture.md",
      newPath: "design.md",
      notes: [stemTarget, stemSource],
      linkMode: "wikilink",
    });
    expect(
      applyPlan(
        new Map([
          ["architecture.md", stemTarget.content!],
          ["guide.md", stemSource.content!],
        ]),
        stemPlan,
      ).get("guide.md"),
    ).toBe("See [[./design.md]].\n");
  });

  test("prefers live buffer content over stale scanned note text", () => {
    const target = note("a.md", "# A\n");
    const scanned = note("b.md", "old\n");
    const live = "See [A](./a.md).\n";
    const plan = planDocumentPathRename({
      oldPath: "a.md",
      newPath: "alpha.md",
      notes: [target, scanned],
      linkMode: "markdown",
      contentByPath: new Map([
        ["a.md", target.content!],
        ["b.md", live],
      ]),
    });
    expect(plan.edits).toHaveLength(1);
    expect(applyTextEdits(live, plan.edits)).toBe("See [A](./alpha.md).\n");
  });
});
