import { describe, expect, test } from "bun:test";

import {
  compactDocumentPath,
  disambiguatedRelativePath,
  documentLocationFromBuffer,
  tabLabelForBuffer,
  tabLabelsForBuffers,
  windowTitleForDocumentLocation,
  type DocumentLocationSource,
} from "../../../../../src/mainview/modules/editor/document/documentLocation.ts";

function buffer(
  overrides: Partial<DocumentLocationSource> & Pick<DocumentLocationSource, "id" | "title">,
): DocumentLocationSource {
  return {
    kind: "persisted",
    path: null,
    absolutePath: null,
    rootPath: null,
    ...overrides,
  };
}

// Intent: one pure projection for document chrome — paths, tabs, window title.
describe("document location", () => {
  test("projects relative paths without inventing a folder, and titles follow the destination", () => {
    expect(
      documentLocationFromBuffer(
        buffer({
          id: "file:/w/docs/guides/index.md",
          title: "index.md",
          rootPath: "/w",
          path: "docs/guides/index.md",
        }),
      ),
    ).toEqual({
      kind: "workspace",
      label: "docs/guides/index.md",
      full: "docs/guides/index.md",
    });

    const long = "very/deeply/nested/folder/structure/with/many/segments/and/a/document.md";
    const compact = documentLocationFromBuffer(
      buffer({ id: "b", title: "document.md", rootPath: "/w", path: long }),
      40,
    );
    expect(compact?.label.startsWith(".../")).toBe(true);
    expect(compact?.label.endsWith("document.md")).toBe(true);
    expect(compact?.label).toBe(compactDocumentPath(long, 40));

    expect(
      documentLocationFromBuffer(buffer({ id: "untitled:1", kind: "virtual", title: "Untitled" })),
    ).toEqual({ kind: "untitled", label: "Untitled", full: "Untitled" });

    expect(
      documentLocationFromBuffer(
        buffer({ id: "file:/tmp/note.md", title: "note.md", absolutePath: "/tmp/note.md" }),
      ),
    ).toEqual({ kind: "standalone", label: "note.md", full: "/tmp/note.md" });

    const unicode = documentLocationFromBuffer(
      buffer({
        id: "u",
        title: "café.md",
        rootPath: "C:\\Notes",
        path: "diario\\café.md",
      }),
    );
    expect(unicode?.full).toBe("diario/café.md");

    const location = documentLocationFromBuffer(
      buffer({ id: "x", title: "index.md", rootPath: "/w", path: "docs/index.md" }),
    );
    expect(windowTitleForDocumentLocation("Fulvid", location, "window-title")).toBe(
      "Fulvid - docs/index.md",
    );
    expect(windowTitleForDocumentLocation("Fulvid", location, "hidden")).toBe("Fulvid");
  });

  test("tabs add path segments only until collisions resolve", () => {
    const notes = buffer({ id: "2", title: "index.md", rootPath: "/w", path: "notes/index.md" });
    const docs = buffer({ id: "3", title: "index.md", rootPath: "/w", path: "docs/index.md" });
    expect(tabLabelsForBuffers([notes, docs]).get("2")).toBe("notes/index.md");
    expect(tabLabelsForBuffers([notes, docs]).get("3")).toBe("docs/index.md");

    const deepA = buffer({
      id: "4",
      title: "index.md",
      rootPath: "/w",
      path: "projects/a/docs/index.md",
    });
    const deepB = buffer({
      id: "5",
      title: "index.md",
      rootPath: "/w",
      path: "projects/b/docs/index.md",
    });
    expect(
      disambiguatedRelativePath("projects/a/docs/index.md", ["projects/b/docs/index.md"]),
    ).toBe("a/docs/index.md");
    expect(tabLabelForBuffer(deepA, [deepA, deepB])).toBe("a/docs/index.md");
  });
});
