import { describe, expect, test } from "bun:test";

import {
  compactDocumentPath,
  disambiguatedRelativePath,
  documentLocationFromBuffer,
  showsMainPanelDocumentLocation,
  showsWindowTitleDocumentLocation,
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

// Intent: one pure projection for document chrome - destinations, compact path, collision tabs.
// Growth boundary: add cases only for new buffer shapes, destinations, or truncation policy.
describe("document location", () => {
  test("workspace paths stay relative and compact without hiding the basename", () => {
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
    const location = documentLocationFromBuffer(
      buffer({
        id: "b",
        title: "document.md",
        rootPath: "/w",
        path: long,
      }),
      40,
    );
    expect(location?.label.startsWith(".../")).toBe(true);
    expect(location?.label.endsWith("document.md")).toBe(true);
    expect(location?.full).toBe(long);
    expect(location?.label).toBe(compactDocumentPath(long, 40));
  });

  test("untitled and standalone fall back without inventing a folder path", () => {
    expect(
      documentLocationFromBuffer(
        buffer({
          id: "untitled:1",
          kind: "virtual",
          title: "Untitled",
        }),
      ),
    ).toEqual({
      kind: "untitled",
      label: "Untitled",
      full: "Untitled",
    });

    expect(
      documentLocationFromBuffer(
        buffer({
          id: "file:/tmp/note.md",
          title: "note.md",
          absolutePath: "/tmp/note.md",
        }),
      ),
    ).toEqual({
      kind: "standalone",
      label: "note.md",
      full: "/tmp/note.md",
    });

    expect(documentLocationFromBuffer(null)).toBeNull();
  });

  test("tabs add path segments only until collisions resolve", () => {
    const only = buffer({
      id: "1",
      title: "index.md",
      rootPath: "/w",
      path: "docs/index.md",
    });
    expect(tabLabelForBuffer(only, [only])).toBe("index.md");

    const notes = buffer({
      id: "2",
      title: "index.md",
      rootPath: "/w",
      path: "notes/index.md",
    });
    const docs = buffer({
      id: "3",
      title: "index.md",
      rootPath: "/w",
      path: "docs/index.md",
    });
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
    expect(tabLabelForBuffer(deepB, [deepA, deepB])).toBe("b/docs/index.md");
  });

  test("destination helpers select one presentation channel", () => {
    const location = documentLocationFromBuffer(
      buffer({
        id: "x",
        title: "index.md",
        rootPath: "/w",
        path: "docs/index.md",
      }),
    );
    expect(showsMainPanelDocumentLocation("main-panel")).toBe(true);
    expect(showsMainPanelDocumentLocation("window-title")).toBe(false);
    expect(showsWindowTitleDocumentLocation("window-title")).toBe(true);
    expect(windowTitleForDocumentLocation("Fulvid", location, "window-title")).toBe(
      "Fulvid - docs/index.md",
    );
    expect(windowTitleForDocumentLocation("Fulvid", location, "hidden")).toBe("Fulvid");
    expect(windowTitleForDocumentLocation("Fulvid", null, "window-title")).toBe("Fulvid");
  });

  test("normalizes path separators and preserves Unicode basenames", () => {
    const location = documentLocationFromBuffer(
      buffer({
        id: "u",
        title: "café.md",
        rootPath: "C:\\Notes",
        path: "diario\\café.md",
      }),
    );
    expect(location?.full).toBe("diario/café.md");
    expect(location?.label).toBe("diario/café.md");
  });
});
