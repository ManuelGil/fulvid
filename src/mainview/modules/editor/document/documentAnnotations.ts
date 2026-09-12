/**
 * Session-local document annotations.
 *
 * An annotation is temporary user context (plain text) attached to a tracked
 * position in the live Monaco model. Monaco owns the decoration/range;
 * Fulvid owns only decoration id + text in a WeakMap keyed by model.
 *
 * Not bookmarks, comments, or metadata: no persistence, path identity,
 * semantic reattachment, dirty state, or filesystem writes.
 *
 * Collapse / delete policy: if Monaco drops the decoration range, the
 * annotation is removed. Fulvid does not relocate it to matching text.
 */
import type * as Monaco from "monaco-editor/editor";

export const DOCUMENT_ANNOTATION_GLYPH_CLASS = "fulvid-document-annotation-glyph";

/** Soft cap: a handful of temporary notes, not an archive. */
export const DOCUMENT_ANNOTATION_MAX = 32;

/**
 * Short plain-text note. Longer writing belongs in the document itself.
 * Enforced on create/edit; stored text is already truncated.
 */
export const DOCUMENT_ANNOTATION_TEXT_MAX = 200;

export type DocumentAnnotationPosition = {
  lineNumber: number;
  column: number;
};

export type DocumentAnnotation = {
  position: DocumentAnnotationPosition;
  text: string;
  decorationId: string;
};

type MonacoApi = typeof Monaco;
type TextModel = Monaco.editor.ITextModel;

type AnnotationRecord = {
  decorationId: string;
  text: string;
};

/** Records for models that still exist. Weak keys drop with GC after dispose. */
const annotationsByModel = new WeakMap<TextModel, AnnotationRecord[]>();

/**
 * Monaco hover uses Markdown. Escape so annotation text stays plain and
 * cannot become emphasis, links, or HTML.
 */
export function annotationTextAsHoverMarkdown(text: string): string {
  return text.replace(/([\\`*_{}[\]()#+\-.!|>])/g, "\\$1");
}

export function normalizeAnnotationText(raw: string): string | null {
  const trimmed = raw.replace(/\s+/g, " ").trim();
  if (!trimmed) {
    return null;
  }
  return trimmed.slice(0, DOCUMENT_ANNOTATION_TEXT_MAX);
}

function annotationDecoration(
  api: MonacoApi,
  position: DocumentAnnotationPosition,
  text: string,
  visible: boolean,
): Monaco.editor.IModelDeltaDecoration {
  const lineNumber = Math.max(1, position.lineNumber);
  const column = Math.max(1, position.column);
  return {
    range: new api.Range(lineNumber, column, lineNumber, column),
    options: {
      stickiness: api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      showIfCollapsed: true,
      zIndex: 1,
      // Hidden: keep the tracked range, omit glyph and hover so presentation
      // is off without disposing anchors or annotation text.
      ...(visible
        ? {
            glyphMarginClassName: DOCUMENT_ANNOTATION_GLYPH_CLASS,
            glyphMarginHoverMessage: { value: annotationTextAsHoverMarkdown(text) },
          }
        : {
            glyphMarginClassName: null,
            glyphMarginHoverMessage: null,
          }),
    },
  };
}

function readRecords(model: TextModel): AnnotationRecord[] {
  return annotationsByModel.get(model) ?? [];
}

function writeRecords(model: TextModel, records: AnnotationRecord[]): void {
  if (records.length === 0) {
    annotationsByModel.delete(model);
    return;
  }
  annotationsByModel.set(model, records);
}

function comparePosition(
  left: DocumentAnnotationPosition,
  right: DocumentAnnotationPosition,
): number {
  if (left.lineNumber !== right.lineNumber) {
    return left.lineNumber - right.lineNumber;
  }
  return left.column - right.column;
}

function positionsMatch(
  left: DocumentAnnotationPosition,
  right: DocumentAnnotationPosition,
): boolean {
  return left.lineNumber === right.lineNumber && left.column === right.column;
}

/** Live annotations sorted by document order. Drops ids Monaco no longer has. */
export function listDocumentAnnotations(api: MonacoApi, model: TextModel): DocumentAnnotation[] {
  void api;
  const records = readRecords(model);
  if (records.length === 0) {
    return [];
  }

  const annotations: DocumentAnnotation[] = [];
  const kept: AnnotationRecord[] = [];
  for (const record of records) {
    const range = model.getDecorationRange(record.decorationId);
    if (!range) {
      continue;
    }
    kept.push(record);
    annotations.push({
      decorationId: record.decorationId,
      text: record.text,
      position: {
        lineNumber: range.startLineNumber,
        column: range.startColumn,
      },
    });
  }

  if (kept.length !== records.length) {
    writeRecords(model, kept);
  }

  return annotations.sort((left, right) => comparePosition(left.position, right.position));
}

export function documentAnnotationCount(api: MonacoApi, model: TextModel): number {
  return listDocumentAnnotations(api, model).length;
}

export function findAnnotationOnLine(
  api: MonacoApi,
  model: TextModel,
  lineNumber: number,
): DocumentAnnotation | null {
  const safeLine = Math.min(Math.max(1, lineNumber), model.getLineCount());
  return (
    listDocumentAnnotations(api, model).find(
      (annotation) => annotation.position.lineNumber === safeLine,
    ) ?? null
  );
}

/** Index of the next annotation after `from`, wrapping. -1 when empty. */
export function nextDocumentAnnotationIndex(
  annotations: readonly DocumentAnnotationPosition[],
  from: DocumentAnnotationPosition,
): number {
  if (annotations.length === 0) {
    return -1;
  }
  for (let index = 0; index < annotations.length; index += 1) {
    if (comparePosition(annotations[index], from) > 0) {
      return index;
    }
  }
  return 0;
}

/** Index of the previous annotation before `from`, wrapping. -1 when empty. */
export function previousDocumentAnnotationIndex(
  annotations: readonly DocumentAnnotationPosition[],
  from: DocumentAnnotationPosition,
): number {
  if (annotations.length === 0) {
    return -1;
  }
  for (let index = annotations.length - 1; index >= 0; index -= 1) {
    if (comparePosition(annotations[index], from) < 0) {
      return index;
    }
  }
  return annotations.length - 1;
}

export function findDocumentAnnotationNear(
  annotations: readonly DocumentAnnotation[],
  from: DocumentAnnotationPosition,
  direction: "next" | "previous",
): DocumentAnnotation | null {
  if (annotations.length === 0) {
    return null;
  }
  const onAnnotation = annotations.findIndex((annotation) =>
    positionsMatch(annotation.position, from),
  );
  if (onAnnotation >= 0) {
    if (direction === "next") {
      return annotations[(onAnnotation + 1) % annotations.length] ?? null;
    }
    return annotations[(onAnnotation - 1 + annotations.length) % annotations.length] ?? null;
  }
  const positions = annotations.map((annotation) => annotation.position);
  const index =
    direction === "next"
      ? nextDocumentAnnotationIndex(positions, from)
      : previousDocumentAnnotationIndex(positions, from);
  return index >= 0 ? (annotations[index] ?? null) : null;
}

export type UpsertDocumentAnnotationResult =
  | { action: "added"; annotation: DocumentAnnotation; count: number }
  | { action: "updated"; annotation: DocumentAnnotation; count: number }
  | { action: "capped"; position: DocumentAnnotationPosition; count: number };

/**
 * Create or replace the annotation on a line (at most one per line).
 * Uses model.deltaDecorations so annotations survive editor setModel tab switches.
 * `visible` controls glyph/hover only; hidden annotations still track and navigate.
 */
export function upsertDocumentAnnotationOnLine(
  api: MonacoApi,
  model: TextModel,
  lineNumber: number,
  column: number,
  rawText: string,
  visible: boolean,
): UpsertDocumentAnnotationResult | null {
  const text = normalizeAnnotationText(rawText);
  if (!text) {
    return null;
  }

  const safeLine = Math.min(Math.max(1, lineNumber), model.getLineCount());
  const maxColumn = model.getLineMaxColumn(safeLine);
  const safeColumn = Math.min(Math.max(1, column), maxColumn);
  const target: DocumentAnnotationPosition = { lineNumber: safeLine, column: safeColumn };

  const records = readRecords(model);
  const kept: AnnotationRecord[] = [];
  let existingId: string | null = null;

  for (const record of records) {
    const range = model.getDecorationRange(record.decorationId);
    if (!range) {
      continue;
    }
    if (range.startLineNumber === safeLine) {
      existingId = record.decorationId;
      continue;
    }
    kept.push(record);
  }

  if (!existingId && kept.length >= DOCUMENT_ANNOTATION_MAX) {
    writeRecords(model, kept);
    return { action: "capped", position: target, count: kept.length };
  }

  const added = model.deltaDecorations(existingId ? [existingId] : [], [
    annotationDecoration(api, target, text, visible),
  ]);
  const decorationId = added[0];
  if (!decorationId) {
    writeRecords(model, kept);
    return null;
  }

  const nextRecords = [...kept, { decorationId, text }];
  writeRecords(model, nextRecords);
  const annotation: DocumentAnnotation = {
    decorationId,
    text,
    position: target,
  };
  return {
    action: existingId ? "updated" : "added",
    annotation,
    count: nextRecords.length,
  };
}

/**
 * Reapply glyph/hover for every live annotation on this model.
 * Does not create, delete, or relocate annotations.
 */
export function applyDocumentAnnotationPresentation(
  api: MonacoApi,
  model: TextModel,
  visible: boolean,
): void {
  const annotations = listDocumentAnnotations(api, model);
  if (annotations.length === 0) {
    return;
  }

  const nextIds = model.deltaDecorations(
    annotations.map((annotation) => annotation.decorationId),
    annotations.map((annotation) =>
      annotationDecoration(api, annotation.position, annotation.text, visible),
    ),
  );

  writeRecords(
    model,
    annotations.map((annotation, index) => ({
      decorationId: nextIds[index] ?? annotation.decorationId,
      text: annotation.text,
    })),
  );
}

export function removeDocumentAnnotationOnLine(
  api: MonacoApi,
  model: TextModel,
  lineNumber: number,
): DocumentAnnotation | null {
  const existing = findAnnotationOnLine(api, model, lineNumber);
  if (!existing) {
    return null;
  }

  const records = readRecords(model);
  const kept = records.filter((record) => record.decorationId !== existing.decorationId);
  model.deltaDecorations([existing.decorationId], []);
  writeRecords(model, kept);
  return existing;
}

export function clearDocumentAnnotations(model: TextModel): number {
  const records = readRecords(model);
  if (records.length === 0) {
    return 0;
  }
  model.deltaDecorations(
    records.map((record) => record.decorationId),
    [],
  );
  writeRecords(model, []);
  return records.length;
}
