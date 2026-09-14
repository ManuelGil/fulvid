import { describe, expect, test } from "bun:test";

import {
  resolveNewDocumentFileName,
  suggestUntitledSaveBasename,
} from "../../../../../src/mainview/modules/editor/document/documentFileNames.ts";

// Intent: seeded create/save naming stays basename-safe and predictable.
describe("document file names", () => {
  test("resolveNewDocumentFileName attaches the default extension and refuses unsafe names", () => {
    expect(resolveNewDocumentFileName("notes", "mdx")).toBe("notes.mdx");
    expect(resolveNewDocumentFileName("notes.md", "mdx")).toBe("notes.md");
    expect(resolveNewDocumentFileName("../escape.md", "md")).toBeNull();
    expect(resolveNewDocumentFileName("notes.txt", "md")).toBeNull();
    expect(resolveNewDocumentFileName("   ", "md")).toBeNull();
  });

  test("suggestUntitledSaveBasename uses the first heading line and falls back safely", () => {
    expect(suggestUntitledSaveBasename("# README\n\nBody", "mdx")).toBe("README.mdx");
    expect(suggestUntitledSaveBasename("Selected paragraph\n\nmore", "md")).toBe(
      "Selected-paragraph.md",
    );
    expect(suggestUntitledSaveBasename("   \n\n", "mdx")).toBe("untitled.mdx");
    expect(suggestUntitledSaveBasename("!!!", "md")).toBe("untitled.md");
  });
});
