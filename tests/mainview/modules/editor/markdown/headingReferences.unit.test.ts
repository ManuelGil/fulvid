import { describe, expect, test } from "bun:test";

import type { DocumentLink } from "../../../../../src/mainview/modules/document/links/documentLink.ts";
import { applyTextEdits } from "../../../../../src/mainview/modules/editor/markdown/markdownFormat.ts";
import {
  collectHeadingReferences,
  planHeadingRename,
  semanticEntityAt,
} from "../../../../../src/mainview/modules/editor/markdown/headingReferences.ts";
import { headingAnchor } from "../../../../../src/mainview/modules/editor/markdown/markdownStructure.ts";
import type { ScannedNote } from "../../../../../src/mainview/modules/workspace/filesystem/workspaceTypes.ts";

function note(path: string, content: string, documentLinks: DocumentLink[] = []): ScannedNote {
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
    tokens: 0,
    words: 0,
    content,
  };
}

function offsetOf(content: string, snippet: string, occurrence = 0): number {
  let from = 0;
  for (let index = 0; index <= occurrence; index += 1) {
    const found = content.indexOf(snippet, from);
    if (found < 0) {
      throw new Error(`Missing ${snippet}`);
    }
    if (index === occurrence) {
      return found;
    }
    from = found + 1;
  }
  throw new Error(`Missing ${snippet}`);
}

function applyPlan(
  documents: { path: string | null; content: string }[],
  plan: NonNullable<ReturnType<typeof planHeadingRename>>,
): Map<string | null, string> {
  const next = new Map(documents.map((document) => [document.path, document.content]));
  const byPath = new Map<string | null, typeof plan.edits>();
  for (const edit of plan.edits) {
    const list = byPath.get(edit.documentPath) ?? [];
    list.push(edit);
    byPath.set(edit.documentPath, list);
  }
  for (const [path, edits] of byPath) {
    next.set(path, applyTextEdits(next.get(path) ?? "", edits));
  }
  return next;
}

const architectureDoc = [
  "# Architecture",
  "",
  "The architecture of Fulvid is simple.",
  "",
  "See [Architecture](#architecture) and [guide](./guide.md).",
  "",
  "[label](#architecture)",
].join("\n");

const guideDoc = ["# Guide", "", "Read [Architecture](architecture.md#architecture)."].join("\n");

// Intent: Find References and semantic Rename follow DocumentLink + heading IDs, not text search.
// Growth boundary: add a case only for a new supported entity or a new refuse-to-edit rule.
describe("heading references", () => {
  test("finds a heading, local fragments, and ignores matching prose and link text", () => {
    const heading = semanticEntityAt(
      architectureDoc,
      offsetOf(architectureDoc, "Architecture"),
      "markdown",
    );
    expect(heading?.kind).toBe("heading");
    expect(heading && heading.kind === "heading" && heading.heading.text).toBe("Architecture");

    const references = collectHeadingReferences(
      heading!.heading,
      "architecture.md",
      [{ path: "architecture.md", content: architectureDoc }],
      [note("architecture.md", architectureDoc)],
      "markdown",
    );
    expect(references.filter((reference) => reference.kind === "heading")).toHaveLength(1);
    expect(references.filter((reference) => reference.kind === "fragment")).toHaveLength(2);
    expect(
      references.some((reference) =>
        architectureDoc.slice(reference.range.start, reference.range.end).includes("simple"),
      ),
    ).toBe(false);
  });

  test("respects wikilink mode and does not invent virtual workspace relations", () => {
    const wiki = ["# Architecture", "", "See [[#architecture]]."].join("\n");
    const heading = semanticEntityAt(wiki, offsetOf(wiki, "Architecture"), "wikilink");
    const local = collectHeadingReferences(
      heading!.heading,
      null,
      [{ path: null, content: wiki }],
      [],
      "wikilink",
    );
    expect(local.map((reference) => reference.kind).sort()).toEqual(["fragment", "heading"]);
    expect(local.every((reference) => reference.documentPath === null)).toBe(true);

    const workspaceNotes = [note("architecture.md", architectureDoc)];
    const virtual = collectHeadingReferences(
      heading!.heading,
      null,
      [{ path: null, content: wiki }],
      workspaceNotes,
      "wikilink",
    );
    expect(virtual.some((reference) => reference.documentPath === "architecture.md")).toBe(false);
  });
});

describe("heading rename", () => {
  test("renames a heading, updates fragment targets, and preserves link text and prose", () => {
    const entity = semanticEntityAt(
      architectureDoc,
      offsetOf(architectureDoc, "Architecture"),
      "markdown",
    );
    const references = collectHeadingReferences(
      entity!.heading,
      "architecture.md",
      [
        { path: "architecture.md", content: architectureDoc },
        { path: "guide.md", content: guideDoc },
      ],
      [note("architecture.md", architectureDoc), note("guide.md", guideDoc)],
      "markdown",
    );
    const plan = planHeadingRename(
      entity!.heading,
      "architecture.md",
      architectureDoc,
      "System Architecture",
      references,
      new Set(["architecture.md", "guide.md"]),
    );
    expect(plan?.nextAnchor).toBe(headingAnchor("System Architecture"));
    const next = applyPlan(
      [
        { path: "architecture.md", content: architectureDoc },
        { path: "guide.md", content: guideDoc },
      ],
      plan!,
    );
    const architecture = next.get("architecture.md") ?? "";
    const guide = next.get("guide.md") ?? "";
    expect(architecture.startsWith("# System Architecture")).toBe(true);
    expect(architecture).toContain("The architecture of Fulvid is simple.");
    expect(architecture).toContain("[Architecture](#system-architecture)");
    expect(architecture).toContain("[label](#system-architecture)");
    expect(architecture).toContain("[guide](./guide.md)");
    expect(guide).toContain("[Architecture](architecture.md#system-architecture)");
    expect(guide.startsWith("# Guide")).toBe(true);
  });

  test("does not rewrite closed documents, ambiguous fragments, or unsupported text", () => {
    const entity = semanticEntityAt(
      architectureDoc,
      offsetOf(architectureDoc, "Architecture"),
      "markdown",
    );
    const references = collectHeadingReferences(
      entity!.heading,
      "architecture.md",
      [
        { path: "architecture.md", content: architectureDoc },
        { path: "guide.md", content: guideDoc },
      ],
      [note("architecture.md", architectureDoc), note("guide.md", guideDoc)],
      "markdown",
    );
    const openOnly = planHeadingRename(
      entity!.heading,
      "architecture.md",
      architectureDoc,
      "System Architecture",
      references,
      new Set(["architecture.md"]),
    );
    expect(openOnly?.edits.some((edit) => edit.documentPath === "guide.md")).toBe(false);

    const duplicate = ["# Architecture", "", "# Architecture", "", "[x](#architecture)"].join("\n");
    const first = semanticEntityAt(duplicate, offsetOf(duplicate, "Architecture"), "markdown");
    const duplicateRefs = collectHeadingReferences(
      first!.heading,
      "dup.md",
      [{ path: "dup.md", content: duplicate }],
      [note("dup.md", duplicate)],
      "markdown",
    );
    const skipped = planHeadingRename(
      first!.heading,
      "dup.md",
      duplicate,
      "System Architecture",
      duplicateRefs,
      new Set(["dup.md"]),
    );
    expect(skipped?.edits).toEqual([expect.objectContaining({ text: "System Architecture" })]);
    expect(skipped?.edits.some((edit) => edit.text === "system-architecture")).toBe(false);

    expect(
      semanticEntityAt(architectureDoc, offsetOf(architectureDoc, "simple"), "markdown"),
    ).toBeNull();
    expect(
      semanticEntityAt(
        architectureDoc,
        offsetOf(architectureDoc, "guide](./guide.md)"),
        "markdown",
      ),
    ).toBeNull();
    expect(semanticEntityAt("<Note value={x} />\n", 1, "markdown")).toBeNull();
    expect(
      planHeadingRename(
        entity!.heading,
        "architecture.md",
        architectureDoc,
        "",
        references,
        new Set(["architecture.md"]),
      ),
    ).toBeNull();
  });
});
