import { describe, expect, test } from "bun:test";

import {
  annotationTextAsHoverMarkdown,
  applyDocumentAnnotationPresentation,
  clearDocumentAnnotations,
  documentAnnotationQuickActionLabelKey,
  documentAnnotationQuickActionMode,
  findDocumentAnnotationNear,
  listDocumentAnnotations,
  nextDocumentAnnotationIndex,
  normalizeAnnotationText,
  previousDocumentAnnotationIndex,
  upsertDocumentAnnotationOnLine,
  DOCUMENT_ANNOTATION_TEXT_MAX,
  type DocumentAnnotation,
  type DocumentAnnotationPosition,
} from "../../../../../src/mainview/modules/editor/document/documentAnnotations.ts";
import {
  documentAnnotationsVisible,
  setDocumentAnnotationsVisible,
  syncDocumentAnnotationsVisibleFromPreference,
  toggleDocumentAnnotationsVisible,
} from "../../../../../src/mainview/modules/editor/document/documentAnnotationVisibility.ts";

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
    glyphMarginHoverMessage?: { value: string } | null;
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

// Intent: session annotations navigate by sorted position; text stays plain and bounded;
// visibility changes presentation without deleting annotation state.
// Growth boundary: keep tests pure; fake model only for Fulvid-owned decoration bookkeeping.
describe("document annotations", () => {
  test("next and previous wrap around the document", () => {
    expect(nextDocumentAnnotationIndex(positions, { lineNumber: 1, column: 1 })).toBe(0);
    expect(nextDocumentAnnotationIndex(positions, { lineNumber: 10, column: 3 })).toBe(2);
    expect(nextDocumentAnnotationIndex(positions, { lineNumber: 25, column: 1 })).toBe(0);

    expect(previousDocumentAnnotationIndex(positions, { lineNumber: 1, column: 1 })).toBe(2);
    expect(previousDocumentAnnotationIndex(positions, { lineNumber: 10, column: 3 })).toBe(0);
    expect(previousDocumentAnnotationIndex(positions, { lineNumber: 25, column: 1 })).toBe(2);
  });

  test("findDocumentAnnotationNear steps from the current annotation or from between them", () => {
    expect(findDocumentAnnotationNear(annotations, { lineNumber: 10, column: 3 }, "next")).toEqual(
      annotations[2],
    );
    expect(
      findDocumentAnnotationNear(annotations, { lineNumber: 10, column: 3 }, "previous"),
    ).toEqual(annotations[0]);
    expect(findDocumentAnnotationNear(annotations, { lineNumber: 5, column: 1 }, "next")).toEqual(
      annotations[1],
    );
    expect(
      findDocumentAnnotationNear(annotations, { lineNumber: 5, column: 1 }, "previous"),
    ).toEqual(annotations[0]);
    expect(findDocumentAnnotationNear([], { lineNumber: 1, column: 1 }, "next")).toBeNull();
  });

  test("annotation text is normalized, capped, and escaped for Monaco hover Markdown", () => {
    expect(normalizeAnnotationText("  hello   world  ")).toBe("hello world");
    expect(normalizeAnnotationText("   ")).toBeNull();
    expect(normalizeAnnotationText("note\u0000with\u0007controls")).toBe("notewithcontrols");
    expect(normalizeAnnotationText("x".repeat(DOCUMENT_ANNOTATION_TEXT_MAX + 40))?.length).toBe(
      DOCUMENT_ANNOTATION_TEXT_MAX,
    );
    expect(annotationTextAsHoverMarkdown("see *this* and [link](x)")).toBe(
      "see \\*this\\* and \\[link\\]\\(x\\)",
    );
    expect(annotationTextAsHoverMarkdown("a <b>tag</b>")).toBe("a \\<b\\>tag\\</b\\>");
    expect(annotationTextAsHoverMarkdown("strike ~~me~~")).toBe("strike \\~\\~me\\~\\~");
  });

  test("visible annotation hover stays untrusted plain Markdown", () => {
    const model = createFakeModel();
    const api = fakeApi as never;
    const added = upsertDocumentAnnotationOnLine(api, model as never, 2, 1, "note <b>x</b>", true);
    expect(added?.action).toBe("added");
    if (!added || added.action === "capped") {
      throw new Error("expected annotation to be added");
    }
    const hover = model.decorationOptions(added.annotation.decorationId)?.glyphMarginHoverMessage;
    expect(hover).toMatchObject({
      value: "note \\<b\\>x\\</b\\>",
      isTrusted: false,
      supportHtml: false,
    });
  });

  test("hiding annotations clears glyph presentation without deleting annotation state", () => {
    const model = createFakeModel();
    const api = fakeApi as never;
    const added = upsertDocumentAnnotationOnLine(api, model as never, 4, 1, "keep me", true);
    expect(added?.action).toBe("added");
    if (!added || added.action === "capped") {
      throw new Error("expected annotation to be added");
    }
    expect(listDocumentAnnotations(api, model as never)).toHaveLength(1);
    const id = added.annotation.decorationId;
    expect(model.decorationOptions(id)?.glyphMarginClassName).toBeTruthy();

    applyDocumentAnnotationPresentation(api, model as never, false);
    const listed = listDocumentAnnotations(api, model as never);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.text).toBe("keep me");
    const hiddenId = listed[0]?.decorationId;
    expect(hiddenId).toBeTruthy();
    expect(model.decorationOptions(hiddenId!)?.glyphMarginClassName).toBeNull();
    expect(model.decorationOptions(hiddenId!)?.glyphMarginHoverMessage).toBeNull();

    applyDocumentAnnotationPresentation(api, model as never, true);
    const shown = listDocumentAnnotations(api, model as never);
    expect(shown).toHaveLength(1);
    const shownId = shown[0]?.decorationId;
    expect(shownId).toBeTruthy();
    expect(model.decorationOptions(shownId!)?.glyphMarginClassName).toBeTruthy();

    clearDocumentAnnotations(model as never);
    expect(listDocumentAnnotations(api, model as never)).toHaveLength(0);
  });
});

describe("document annotation visibility", () => {
  test("session toggle and preference sync stay presentation-only", () => {
    setDocumentAnnotationsVisible(true);
    expect(toggleDocumentAnnotationsVisible()).toBe(false);
    expect(documentAnnotationsVisible.value).toBe(false);
    syncDocumentAnnotationsVisibleFromPreference(true);
    expect(documentAnnotationsVisible.value).toBe(true);
    syncDocumentAnnotationsVisibleFromPreference(false);
    expect(documentAnnotationsVisible.value).toBe(false);
    setDocumentAnnotationsVisible(true);
  });
});

describe("document annotation quick action mode", () => {
  test("no annotation at current line → Add annotation", () => {
    expect(documentAnnotationQuickActionMode(false)).toBe("add");
    expect(documentAnnotationQuickActionLabelKey("add")).toBe("documentAnnotations.addTitle");
  });

  test("annotation at current line → Edit annotation", () => {
    expect(documentAnnotationQuickActionMode(true)).toBe("edit");
    expect(documentAnnotationQuickActionLabelKey("edit")).toBe("documentAnnotations.editTitle");
  });

  test("mode follows position changes", () => {
    expect(documentAnnotationQuickActionMode(false)).toBe("add");
    expect(documentAnnotationQuickActionMode(true)).toBe("edit");
    expect(documentAnnotationQuickActionMode(false)).toBe("add");
  });
});
