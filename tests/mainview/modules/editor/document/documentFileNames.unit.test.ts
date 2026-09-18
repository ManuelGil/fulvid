import { describe, expect, test } from "bun:test";

import {
  resolveNewDocumentFileName,
  suggestUntitledSaveBasename,
} from "../../../../../src/mainview/modules/editor/document/documentFileNames.ts";

// Intent: seeded create/save naming stays basename-safe and predictable.
describe("document file names", () => {
  test("create and untitled save names stay basename-safe", () => {
    expect(resolveNewDocumentFileName("notes", "mdx")).toBe("notes.mdx");
    expect(resolveNewDocumentFileName("notes.md", "mdx")).toBe("notes.md");
    expect(resolveNewDocumentFileName("../escape.md", "md")).toBeNull();
    expect(resolveNewDocumentFileName("notes.txt", "md")).toBeNull();
    expect(resolveNewDocumentFileName("   ", "md")).toBeNull();
    expect(resolveNewDocumentFileName("notes.md ", "md")).toBeNull();
    expect(resolveNewDocumentFileName("notes.md.", "md")).toBeNull();
    expect(resolveNewDocumentFileName(" CON.md", "md")).toBeNull();
    expect(resolveNewDocumentFileName("CON.md", "md")).toBeNull();
    expect(resolveNewDocumentFileName("note:ads.md", "md")).toBeNull();

    expect(suggestUntitledSaveBasename("# README\n\nBody", "mdx")).toBe("README.mdx");
    expect(suggestUntitledSaveBasename("Selected paragraph\n\nmore", "md")).toBe(
      "Selected-paragraph.md",
    );
    expect(suggestUntitledSaveBasename("   \n\n", "mdx")).toBe("untitled.mdx");
    expect(suggestUntitledSaveBasename("!!!", "md")).toBe("untitled.md");
    expect(suggestUntitledSaveBasename("# CON\n", "md")).toBe("untitled.md");
  });
});
