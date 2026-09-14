import { describe, expect, test } from "bun:test";

import { parseDocumentLinks } from "../../../../../src/mainview/modules/document/links/documentLink.ts";
import {
  documentTargetRange,
  planDocumentPathRename,
} from "../../../../../src/mainview/modules/document/links/documentPathRename.ts";
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

// Intent: Explorer rename keeps resolvable inbound links continuous without a refactor engine.
// Growth boundary: add cases only for a new supported rewrite rule or refuse-to-edit boundary.
describe("document path rename", () => {
  test("renames without references leave other documents untouched", () => {
    const notes = [note("a.md", "# A\n"), note("b.md", "# B\n")];
    const plan = planDocumentPathRename({
      oldPath: "a.md",
      newPath: "alpha.md",
      notes,
      linkMode: "markdown",
    });
    expect(plan.edits).toEqual([]);
  });

  test("updates a markdown reference to the new relative path", () => {
    const target = note("docs/architecture.md", "# Architecture\n");
    const source = note("notes/guide.md", "See [Architecture](../docs/architecture.md).\n");
    const plan = planDocumentPathRename({
      oldPath: "docs/architecture.md",
      newPath: "docs/design.md",
      notes: [target, source],
      linkMode: "markdown",
    });
    const next = applyPlan(
      new Map([
        ["docs/architecture.md", target.content!],
        ["notes/guide.md", source.content!],
      ]),
      plan,
    );
    expect(next.get("notes/guide.md")).toBe("See [Architecture](../docs/design.md).\n");
    expect(next.get("docs/design.md")).toBe("# Architecture\n");
  });

  test("updates wikilink targets while preserving labels and fragments", () => {
    const target = note("docs/architecture.md", "# Architecture\n\n## Overview\n");
    const source = note(
      "notes/guide.md",
      "See [[../docs/architecture.md#overview|Architecture]].\n",
    );
    const plan = planDocumentPathRename({
      oldPath: "docs/architecture.md",
      newPath: "docs/design.md",
      notes: [target, source],
      linkMode: "wikilink",
    });
    const next = applyPlan(
      new Map([
        ["docs/architecture.md", target.content!],
        ["notes/guide.md", source.content!],
      ]),
      plan,
    );
    expect(next.get("notes/guide.md")).toBe("See [[../docs/design.md#overview|Architecture]].\n");
  });

  test("preserves heading fragments on markdown links", () => {
    const target = note("a.md", "# A\n\n## Section\n");
    const source = note("b.md", "[A](./a.md#section)\n");
    const plan = planDocumentPathRename({
      oldPath: "a.md",
      newPath: "alpha.md",
      notes: [target, source],
      linkMode: "markdown",
    });
    const next = applyPlan(
      new Map([
        ["a.md", target.content!],
        ["b.md", source.content!],
      ]),
      plan,
    );
    expect(next.get("b.md")).toBe("[A](./alpha.md#section)\n");
  });

  test("updates multiple references in one document and leaves unrelated links alone", () => {
    const renamed = note("target.md", "# Target\n");
    const other = note("other.md", "# Other\n");
    const source = note(
      "index.md",
      ["[one](./target.md)", "[two](./target.md#x)", "[other](./other.md)", ""].join("\n"),
    );
    const plan = planDocumentPathRename({
      oldPath: "target.md",
      newPath: "renamed.md",
      notes: [renamed, other, source],
      linkMode: "markdown",
    });
    const next = applyPlan(
      new Map([
        ["target.md", renamed.content!],
        ["other.md", other.content!],
        ["index.md", source.content!],
      ]),
      plan,
    );
    expect(next.get("index.md")).toBe(
      ["[one](./renamed.md)", "[two](./renamed.md#x)", "[other](./other.md)", ""].join("\n"),
    );
  });

  test("rewrites stem wikilinks that resolve to the renamed document", () => {
    const target = note("architecture.md", "# Architecture\n");
    const source = note("guide.md", "See [[architecture]].\n");
    const plan = planDocumentPathRename({
      oldPath: "architecture.md",
      newPath: "design.md",
      notes: [target, source],
      linkMode: "wikilink",
    });
    const next = applyPlan(
      new Map([
        ["architecture.md", target.content!],
        ["guide.md", source.content!],
      ]),
      plan,
    );
    expect(next.get("guide.md")).toBe("See [[./design.md]].\n");
  });

  test("uses live buffer content when planning instead of stale scan text", () => {
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

  test("documentTargetRange covers only the path span", () => {
    const [markdown] = parseDocumentLinks("[Label](./path.md#frag)", "markdown");
    expect(documentTargetRange(markdown!)).toEqual({ start: 8, end: 17 });
    const [wikilink] = parseDocumentLinks("[[./path.md#frag|Label]]", "wikilink");
    expect(documentTargetRange(wikilink!)).toEqual({ start: 2, end: 11 });
  });
});
