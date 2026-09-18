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

// Intent: Save As never proposes a name whose displayed form differs from the
// name it would create. The slug drops bidi and invisible formatting characters,
// so a spoofed heading cannot seed a spoofed filename.
// Growth boundary: add a case only for a new character class, not a new caller.
// Characters use ASCII escapes per the repository human-language contract.
describe("untitled save suggestions resist display spoofing", () => {
  test("drops bidi and invisible formatting characters from the suggestion", () => {
    const spoofable = new RegExp(
      "[" +
        [
          0x200b, 0x200c, 0x200d, 0x200e, 0x200f, 0x202a, 0x202b, 0x202c, 0x202d, 0x202e, 0x2066,
          0x2067, 0x2068, 0x2069, 0x061c,
        ]
          .map((code) => String.fromCodePoint(code))
          .join("") +
        "]",
      "u",
    );

    for (const [heading, expected] of [
      ["# safe\u202Etxt", "safetxt.mdx"],
      ["# a\u200Bb", "ab.mdx"],
      ["# \u2066spoof\u2069", "spoof.mdx"],
    ] as const) {
      const suggestion = suggestUntitledSaveBasename(heading + "\n", "mdx");
      expect(suggestion).toBe(expected);
      expect(spoofable.test(suggestion)).toBe(false);
    }

    // A heading made only of formatting characters leaves no slug to use.
    expect(suggestUntitledSaveBasename("# \u202E\u200B" + "\n", "mdx")).toBe("untitled.mdx");
  });
});
