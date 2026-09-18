/**
 * Ephemeral session change markers: baseline vs current Monaco model.
 *
 * Monaco owns live text and decorations. This module owns an in-memory baseline,
 * decoration ids, and the last applied hunk ranges for marker preview. Not Git,
 * not history, not IndexedDB, not a second text authority.
 */
import type * as Monaco from "monaco-editor/editor";

import { initializeMonaco } from "../monaco/monacoSetup";
import {
  changeMarkerSpecsFromLineChanges,
  hunkSnippetsFromTexts,
  lineChangeRangeForMarkerLine,
  lineChangeRangeKey,
  type ChangeMarkerSpec,
  type LineChangeRange,
} from "./sessionChangeMarkerMapping";

export {
  changeMarkerSpecsFromLineChanges,
  hunkSnippetsFromTexts,
  lineChangeRangeForMarkerLine,
  lineChangeRangeKey,
  type ChangeMarkerKind,
  type ChangeMarkerSpec,
  type LineChangeRange,
} from "./sessionChangeMarkerMapping";

/** Hunk-scoped DiffEditor payload; derived presentation only. */
export type SessionChangePreviewPayload = {
  hunk: LineChangeRange;
  hunkKey: string;
  before: string;
  after: string;
  versionId: number;
};

export const CHANGE_MARKER_MODIFIED_CLASS = "fulvid-change-marker-modified";
export const CHANGE_MARKER_ADDED_CLASS = "fulvid-change-marker-added";
export const CHANGE_MARKER_DELETED_CLASS = "fulvid-change-marker-deleted";

const CHANGE_MARKER_DEBOUNCE_MS = 200;

type MonacoApi = typeof Monaco;
type TextModel = Monaco.editor.ITextModel;
type LineChange = Monaco.editor.ILineChange;

type MarkerState = {
  baseline: string;
  decorationIds: string[];
  lastChanges: LineChangeRange[];
  changesVersionId: number | null;
  generation: number;
  timer: ReturnType<typeof setTimeout> | null;
  inFlight: Promise<void> | null;
};

const stateByModel = new WeakMap<TextModel, MarkerState>();

let diffHost: HTMLElement | null = null;
/** Serialize transient DiffEditors - they share one host element. */
let diffEditorQueue: Promise<unknown> = Promise.resolve();

function ensureDiffHost(): HTMLElement {
  if (typeof document === "undefined") {
    throw new Error("change markers require a DOM document");
  }
  if (!diffHost || !diffHost.isConnected) {
    diffHost = document.createElement("div");
    diffHost.setAttribute("aria-hidden", "true");
    diffHost.style.cssText =
      "position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0,0,0,0);left:0;top:0;";
    document.body.appendChild(diffHost);
  }
  return diffHost;
}

function decorationsFromSpecs(
  api: MonacoApi,
  specs: readonly ChangeMarkerSpec[],
): Monaco.editor.IModelDeltaDecoration[] {
  return specs.map((spec) => {
    const className =
      spec.kind === "added"
        ? CHANGE_MARKER_ADDED_CLASS
        : spec.kind === "deleted"
          ? CHANGE_MARKER_DELETED_CLASS
          : CHANGE_MARKER_MODIFIED_CLASS;
    return {
      range: new api.Range(spec.lineNumber, 1, spec.lineNumber, 1),
      options: {
        description: `fulvid-change-marker-${spec.kind}`,
        isWholeLine: true,
        linesDecorationsClassName: className,
        stickiness: api.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
      },
    };
  });
}

function waitForLineChanges(
  diffEditor: Monaco.editor.IStandaloneDiffEditor,
): Promise<LineChange[]> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timeout = setTimeout(() => {
      if (settled) {
        return;
      }
      settled = true;
      disposable.dispose();
      reject(new Error("change marker diff timed out"));
    }, 60_000);

    const finish = (): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timeout);
      disposable.dispose();
      resolve(diffEditor.getLineChanges() ?? []);
    };

    const disposable = diffEditor.onDidUpdateDiff(() => {
      finish();
    });

    if (diffEditor.getLineChanges() !== null) {
      finish();
    }
  });
}

/**
 * Transient public DiffEditor for line changes only.
 * Never attaches an open document model; serialized on a shared clipped host.
 */
export async function computeLineChangesWithTransientDiffEditor(
  baseline: string,
  current: string,
): Promise<LineChangeRange[]> {
  if (baseline === current) {
    return [];
  }

  const run = async (): Promise<LineChangeRange[]> => {
    const api = initializeMonaco();
    const host = ensureDiffHost();
    const original = api.editor.createModel(baseline, "plaintext");
    const modified = api.editor.createModel(current, "plaintext");
    const diffEditor = api.editor.createDiffEditor(host, {
      renderSideBySide: false,
      automaticLayout: false,
      enableSplitViewResizing: false,
      readOnly: true,
      renderOverviewRuler: false,
      renderIndicators: false,
      ignoreTrimWhitespace: false,
      originalEditable: false,
    });
    try {
      diffEditor.setModel({ original, modified });
      const changes = await waitForLineChanges(diffEditor);
      return changes.map((change) => ({
        originalStartLineNumber: change.originalStartLineNumber,
        originalEndLineNumber: change.originalEndLineNumber,
        modifiedStartLineNumber: change.modifiedStartLineNumber,
        modifiedEndLineNumber: change.modifiedEndLineNumber,
      }));
    } finally {
      diffEditor.setModel(null);
      diffEditor.dispose();
      original.dispose();
      modified.dispose();
    }
  };

  const queued = diffEditorQueue.then(run, run);
  diffEditorQueue = queued.then(
    () => undefined,
    () => undefined,
  );
  return queued;
}

function clearDecorations(model: TextModel, state: MarkerState): void {
  state.lastChanges = [];
  state.changesVersionId = null;
  if (state.decorationIds.length === 0 || model.isDisposed()) {
    state.decorationIds = [];
    return;
  }
  state.decorationIds = model.deltaDecorations(state.decorationIds, []);
}

function invalidateHunkCache(state: MarkerState): void {
  state.lastChanges = [];
  state.changesVersionId = null;
}

export function bindSessionChangeMarkers(model: TextModel, baselineContent: string): void {
  const existing = stateByModel.get(model);
  if (existing) {
    if (existing.timer) {
      clearTimeout(existing.timer);
      existing.timer = null;
    }
    existing.generation += 1;
    clearDecorations(model, existing);
    existing.baseline = baselineContent;
    return;
  }
  stateByModel.set(model, {
    baseline: baselineContent,
    decorationIds: [],
    lastChanges: [],
    changesVersionId: null,
    generation: 0,
    timer: null,
    inFlight: null,
  });
}

/** After successful save / Save As: baseline becomes current text; markers clear. */
export function resetSessionChangeBaseline(model: TextModel, baselineContent: string): void {
  const state = stateByModel.get(model);
  if (!state) {
    bindSessionChangeMarkers(model, baselineContent);
    return;
  }
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.generation += 1;
  state.baseline = baselineContent;
  clearDecorations(model, state);
}

/**
 * Move marker session state when Monaco replaces a model (rename / Save As
 * reidentify). Keeps the prior baseline so markers stay meaningful until save.
 */
export function transferSessionChangeMarkers(from: TextModel, to: TextModel): void {
  const prior = stateByModel.get(from);
  const baseline = prior?.baseline ?? to.getValue();
  disposeSessionChangeMarkers(from);
  bindSessionChangeMarkers(to, baseline);
  scheduleSessionChangeMarkers(to);
}

export function disposeSessionChangeMarkers(model: TextModel): void {
  const state = stateByModel.get(model);
  if (!state) {
    return;
  }
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
  }
  state.generation += 1;
  clearDecorations(model, state);
  stateByModel.delete(model);
}

async function recalculate(model: TextModel, generation: number): Promise<void> {
  const state = stateByModel.get(model);
  if (!state || state.generation !== generation || model.isDisposed()) {
    return;
  }
  const versionId = model.getVersionId();
  const current = model.getValue();
  let changes: LineChangeRange[] = [];
  try {
    if (current !== state.baseline) {
      changes = await computeLineChangesWithTransientDiffEditor(state.baseline, current);
    }
  } catch {
    // Diff failure must not break editing; leave previous decorations.
    return;
  }
  const latest = stateByModel.get(model);
  if (
    !latest ||
    latest.generation !== generation ||
    model.isDisposed() ||
    model.getVersionId() !== versionId
  ) {
    return;
  }
  const api = initializeMonaco();
  const specs = changeMarkerSpecsFromLineChanges(changes);
  latest.decorationIds = model.deltaDecorations(
    latest.decorationIds,
    decorationsFromSpecs(api, specs),
  );
  latest.lastChanges = changes;
  latest.changesVersionId = versionId;
}

export function scheduleSessionChangeMarkers(model: TextModel): void {
  const state = stateByModel.get(model);
  if (!state || model.isDisposed()) {
    return;
  }
  if (state.timer) {
    clearTimeout(state.timer);
  }
  // Drop hunk cache until recalculate finishes so preview cannot use a stale version.
  invalidateHunkCache(state);
  const generation = state.generation + 1;
  state.generation = generation;
  state.timer = setTimeout(() => {
    state.timer = null;
    const work = recalculate(model, generation).finally(() => {
      if (state.inFlight === work) {
        state.inFlight = null;
      }
    });
    state.inFlight = work;
  }, CHANGE_MARKER_DEBOUNCE_MS);
}

/**
 * Resolve a marker-line click to hunk-scoped before/after text.
 * Flushes pending marker work first; never runs a separate DiffEditor path.
 * Preview DiffEditors must use the returned strings, never the live model.
 */
export async function resolveSessionChangePreviewAtLine(
  model: TextModel,
  lineNumber: number,
): Promise<SessionChangePreviewPayload | null> {
  const state = stateByModel.get(model);
  if (!state || model.isDisposed()) {
    return null;
  }
  if (state.timer !== null) {
    clearTimeout(state.timer);
    state.timer = null;
    const generation = state.generation;
    const work = recalculate(model, generation).finally(() => {
      if (state.inFlight === work) {
        state.inFlight = null;
      }
    });
    state.inFlight = work;
  }
  if (state.inFlight) {
    await state.inFlight;
  }
  const latest = stateByModel.get(model);
  if (!latest || model.isDisposed()) {
    return null;
  }
  if (latest.changesVersionId === null || latest.changesVersionId !== model.getVersionId()) {
    return null;
  }
  const hunk = lineChangeRangeForMarkerLine(latest.lastChanges, lineNumber);
  if (!hunk) {
    return null;
  }
  const snippets = hunkSnippetsFromTexts(latest.baseline, model.getValue(), hunk);
  return {
    hunk,
    hunkKey: lineChangeRangeKey(hunk),
    before: snippets.before,
    after: snippets.after,
    versionId: latest.changesVersionId,
  };
}

/** Test helper: flush pending debounce and await in-flight diff. */
export async function flushSessionChangeMarkersForTests(model: TextModel): Promise<void> {
  const state = stateByModel.get(model);
  if (!state) {
    return;
  }
  if (state.timer) {
    clearTimeout(state.timer);
    state.timer = null;
    const generation = state.generation;
    await recalculate(model, generation);
  }
  if (state.inFlight) {
    await state.inFlight;
  }
}

/** Test helper: read baseline without exposing WeakMap. */
export function getSessionChangeBaselineForTests(model: TextModel): string | null {
  return stateByModel.get(model)?.baseline ?? null;
}
