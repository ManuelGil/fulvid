import { describe, expect, test } from "bun:test";

import {
  annotationTextAsHoverMarkdown,
  applyDocumentAnnotationPresentation,
  clearDocumentAnnotations,
  findDocumentAnnotationNear,
  listDocumentAnnotations,
  nextDocumentAnnotationIndex,
  normalizeAnnotationText,
  previousDocumentAnnotationIndex,
  upsertDocumentAnnotationOnLine,
  DOCUMENT_ANNOTATION_TEXT_MAX,
  DOCUMENT_ANNOTATION_MAX,
  type DocumentAnnotation,
  type DocumentAnnotationPosition,
} from "../../../../../src/mainview/modules/editor/document/documentAnnotations.ts";

const positions: DocumentAnnotationPosition[] = [
  { lineNumber: 2, column: 1 },
  { lineNumber: 10, column: 3 },
  { lineNumber: 20, column: 1 },
];

const annotations: DocumentAnnotation[] = positions.map((position, index) => ({
  position,
  text: `note-${index}`,
  decorationId: `id-${index}`,
}));

type FakeRange = {
  startLineNumber: number;
  startColumn: number;
};

type FakeDecoration = {
  range: FakeRange;
  options: {
    glyphMarginClassName?: string | null;
    glyphMarginHoverMessage?: { value: string; isTrusted?: boolean; supportHtml?: boolean } | null;
  };
};

function createFakeModel(lineCount = 40) {
  const decorations = new Map<string, FakeDecoration>();
  let nextId = 1;
  const model = {
    getLineCount: () => lineCount,
    getLineMaxColumn: () => 80,
    getDecorationRange: (id: string) => decorations.get(id)?.range ?? null,
    deltaDecorations: (oldIds: string[], news: FakeDecoration[]) => {
      for (const id of oldIds) {
        decorations.delete(id);
      }
      return news.map((decoration) => {
        const id = `d${nextId}`;
        nextId += 1;
        decorations.set(id, decoration);
        return id;
      });
    },
    decorationOptions: (id: string) => decorations.get(id)?.options ?? null,
  };
  return model;
}

const fakeApi = {
  Range: class {
    constructor(
      public startLineNumber: number,
      public startColumn: number,
      public endLineNumber: number,
      public endColumn: number,
    ) {}
  },
  editor: {
    TrackedRangeStickiness: {
      NeverGrowsWhenTypingAtEdges: 1,
    },
  },
};

// Intent: session annotations navigate by position; hover stays plain/untrusted;
// hiding changes presentation without deleting annotation state.
describe("document annotations", () => {
  test("navigates, keeps hover untrusted, and hides glyphs without deleting state", () => {
    expect(nextDocumentAnnotationIndex(positions, { lineNumber: 25, column: 1 })).toBe(0);
    expect(previousDocumentAnnotationIndex(positions, { lineNumber: 1, column: 1 })).toBe(2);
    expect(findDocumentAnnotationNear(annotations, { lineNumber: 10, column: 3 }, "next")).toEqual(
      annotations[2],
    );
    expect(findDocumentAnnotationNear(annotations, { lineNumber: 5, column: 1 }, "next")).toEqual(
      annotations[1],
    );

    // Annotation text comes from the user and is shown in Monaco hover Markdown.
    // Escaping + isTrusted:false is the XSS boundary for that surface.
    expect(normalizeAnnotationText("  hello   world  ")).toBe("hello world");
    expect(normalizeAnnotationText("x".repeat(DOCUMENT_ANNOTATION_TEXT_MAX + 40))?.length).toBe(
      DOCUMENT_ANNOTATION_TEXT_MAX,
    );
    expect(annotationTextAsHoverMarkdown("a <b>tag</b>")).toBe("a \\<b\\>tag\\</b\\>");

    const model = createFakeModel();
    const api = fakeApi as never;
    const added = upsertDocumentAnnotationOnLine(api, model as never, 2, 1, "note <b>x</b>", true);
    expect(added?.action).toBe("added");
    if (!added || added.action === "capped") {
      throw new Error("expected annotation to be added");
    }
    expect(
      model.decorationOptions(added.annotation.decorationId)?.glyphMarginHoverMessage,
    ).toMatchObject({
      value: "note \\<b\\>x\\</b\\>",
      isTrusted: false,
      supportHtml: false,
    });

    const visible = upsertDocumentAnnotationOnLine(api, model as never, 4, 1, "keep me", true);
    expect(visible?.action).toBe("added");
    if (!visible || visible.action === "capped") {
      throw new Error("expected annotation to be added");
    }

    applyDocumentAnnotationPresentation(api, model as never, false);
    const listed = listDocumentAnnotations(api, model as never);
    expect(listed).toHaveLength(2);
    const keepMe = listed.find((annotation) => annotation.text === "keep me");
    expect(keepMe).toBeDefined();
    expect(model.decorationOptions(keepMe!.decorationId)?.glyphMarginClassName).toBeNull();

    applyDocumentAnnotationPresentation(api, model as never, true);
    const shown = listDocumentAnnotations(api, model as never).find(
      (annotation) => annotation.text === "keep me",
    );
    expect(model.decorationOptions(shown!.decorationId)?.glyphMarginClassName).toBeTruthy();

    clearDocumentAnnotations(model as never);
    expect(listDocumentAnnotations(api, model as never)).toHaveLength(0);

    for (let line = 1; line <= DOCUMENT_ANNOTATION_MAX; line += 1) {
      const result = upsertDocumentAnnotationOnLine(
        api,
        model as never,
        line,
        1,
        `cap-${line}`,
        true,
      );
      expect(result?.action).toBe("added");
    }
    expect(listDocumentAnnotations(api, model as never)).toHaveLength(DOCUMENT_ANNOTATION_MAX);
    const capped = upsertDocumentAnnotationOnLine(
      api,
      model as never,
      DOCUMENT_ANNOTATION_MAX + 1,
      1,
      "overflow",
      true,
    );
    expect(capped).toEqual({
      action: "capped",
      position: { lineNumber: DOCUMENT_ANNOTATION_MAX + 1, column: 1 },
      count: DOCUMENT_ANNOTATION_MAX,
    });
    expect(listDocumentAnnotations(api, model as never)).toHaveLength(DOCUMENT_ANNOTATION_MAX);
    expect(
      listDocumentAnnotations(api, model as never).some(
        (annotation) => annotation.text === "overflow",
      ),
    ).toBe(false);
  });
});
