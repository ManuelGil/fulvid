import { afterEach, describe, expect, mock, test } from "bun:test";

type FakeModel = {
  value: string;
  language: string;
  disposed: boolean;
  version: number;
  eol: "\n" | "\r\n";
  listeners: Set<() => void>;
  getAlternativeVersionId(): number;
  getValue(): string;
  getEOL(): "\n" | "\r\n";
  getEndOfLineSequence(): 0 | 1;
  setEOL(eol: 0 | 1): void;
  pushEOL(eol: 0 | 1): void;
  setValue(value: string): void;
  onDidChangeContent(listener: () => void): { dispose(): void };
  dispose(): void;
};

const models: FakeModel[] = [];
let nextSaveAsResult: {
  status: "saved";
  absolutePath: string;
  mtimeMs: number;
  grantToken: string;
} = {
  status: "saved",
  absolutePath: "/workspace/saved.md",
  mtimeMs: 2,
  grantToken: "grant-1",
};
let lastWrittenContent = "";
let lastWrittenPath = "";
let nextReadContent: string | null = null;
let rewriteHook: (() => void) | null = null;
let writeGate: Promise<void> | null = null;
let saveAsGate: Promise<void> | null = null;
let writeHook: (() => void) | null = null;
let readHook: ((path: string) => Promise<void>) | null = null;

mock.module("../../../../../src/mainview/modules/workspace/filesystem/workspaceScanner.ts", () => ({
  readDocument: async (_rootPath: string, path: string) => {
    await readHook?.(path);
    return {
      path,
      absolutePath: `/workspace/${path}`,
      content: nextReadContent ?? `# ${path}`,
      mtimeMs: 1,
    };
  },
  writeDocument: async (_rootPath: string, path: string, content: string) => {
    lastWrittenContent = content;
    lastWrittenPath = path;
    const hook = writeHook;
    writeHook = null;
    hook?.();
    if (writeGate) {
      await writeGate;
    }
    return {
      note: {
        path: "unused.md",
        name: "unused.md",
        title: "Unused",
        aliases: [],
        documentLinks: [],
        tags: [],
        categories: [],
        projects: [],
        summary: "",
        words: 0,
      },
      mtimeMs: 2,
    };
  },
  pickAndSaveDocument: async () => {
    if (saveAsGate) {
      await saveAsGate;
    }
    return nextSaveAsResult;
  },
  writeGrantedDocument: async () => {
    rewriteHook?.();
    rewriteHook = null;
    return {
      absolutePath: nextSaveAsResult.absolutePath,
      mtimeMs: 3,
      grantToken: nextSaveAsResult.grantToken,
    };
  },
  grantDetachedWorkspaceDocument: async () => ({
    absolutePath: "/workspace/detached.md",
    mtimeMs: 3,
    grantToken: "grant-detached",
  }),
}));

mock.module("../../../../../src/mainview/modules/editor/monaco/monacoSetup.ts", () => ({
  initializeMonaco: () => ({
    Uri: {
      file: (path: string) => ({ path }),
      parse: (path: string) => ({ path }),
    },
    editor: {
      EndOfLineSequence: { LF: 0, CRLF: 1 },
      createModel: (value: string, language = "markdown") => {
        const model: FakeModel = {
          value,
          language,
          disposed: false,
          version: 1,
          eol: value.includes("\r\n") ? "\r\n" : "\n",
          listeners: new Set(),
          getAlternativeVersionId() {
            return this.version;
          },
          getValue() {
            return this.value.replace(/\r\n|\n/g, this.eol);
          },
          getEOL() {
            return this.eol;
          },
          getEndOfLineSequence() {
            return this.eol === "\r\n" ? 1 : 0;
          },
          setEOL(eol) {
            this.eol = eol === 1 ? "\r\n" : "\n";
            this.value = this.value.replace(/\r\n|\n/g, this.eol);
          },
          pushEOL(eol) {
            this.setEOL(eol);
            this.version += 1;
            this.listeners.forEach((listener) => listener());
          },
          setValue(nextValue) {
            this.value = nextValue;
            this.eol = nextValue.includes("\r\n") ? "\r\n" : "\n";
            this.version += 1;
            this.listeners.forEach((listener) => listener());
          },
          onDidChangeContent(listener) {
            this.listeners.add(listener);
            return {
              dispose: () => this.listeners.delete(listener),
            };
          },
          dispose() {
            this.disposed = true;
          },
        };
        models.push(model);
        return model;
      },
    },
  }),
  languageForPath: (path: string) => (path.toLowerCase().endsWith(".mdx") ? "mdx" : "markdown"),
}));

const draftPuts: Array<{ recoveryId: string; content: string }> = [];
const draftDeletes: string[] = [];
let draftIdSeq = 0;
let listedDrafts: Array<{ recoveryId: string; content: string; updatedAt: number }> = [];
let listDraftsShouldFail = false;

mock.module("../../../../../src/mainview/modules/editor/document/untitledDraftStore.ts", () => ({
  MAX_UNTITLED_DRAFT_CHARS: 8_000_000,
  createUntitledDraftRecoveryId: () => {
    draftIdSeq += 1;
    return `recovery-${draftIdSeq}`;
  },
  scheduleUntitledDraftPersist: (recoveryId: string, content: string) => {
    draftPuts.push({ recoveryId, content });
  },
  flushUntitledDraftWrites: async () => undefined,
  deleteUntitledDraft: async (recoveryId: string) => {
    draftDeletes.push(recoveryId);
  },
  cancelPendingUntitledDraftWrite: () => undefined,
  listUntitledDrafts: async () => {
    if (listDraftsShouldFail) {
      throw new Error("indexedDB unavailable");
    }
    return listedDrafts;
  },
  putUntitledDraft: async () => undefined,
  resetUntitledDraftStoreForTests: () => undefined,
}));

const changeMarkerCalls: {
  bind: Array<{ content: string }>;
  reset: Array<{ content: string }>;
  dispose: number;
  schedule: number;
} = {
  bind: [],
  reset: [],
  dispose: 0,
  schedule: 0,
};

mock.module("../../../../../src/mainview/modules/editor/document/sessionChangeMarkers.ts", () => ({
  CHANGE_MARKER_MODIFIED_CLASS: "fulvid-change-marker-modified",
  CHANGE_MARKER_ADDED_CLASS: "fulvid-change-marker-added",
  CHANGE_MARKER_DELETED_CLASS: "fulvid-change-marker-deleted",
  changeMarkerSpecsFromLineChanges: () => [],
  computeLineChangesWithTransientDiffEditor: async () => [],
  bindSessionChangeMarkers: (_model: unknown, content: string) => {
    changeMarkerCalls.bind.push({ content });
  },
  resetSessionChangeBaseline: (_model: unknown, content: string) => {
    changeMarkerCalls.reset.push({ content });
  },
  transferSessionChangeMarkers: () => undefined,
  disposeSessionChangeMarkers: () => {
    changeMarkerCalls.dispose += 1;
  },
  scheduleSessionChangeMarkers: () => {
    changeMarkerCalls.schedule += 1;
  },
  flushSessionChangeMarkersForTests: async () => undefined,
  getSessionChangeBaselineForTests: () => null,
}));

const {
  awaitAllBufferWrites,
  awaitBufferWrites,
  closeAllDocuments,
  saveDocument,
  saveAsDocument,
  closeDocument,
  closeDocumentById,
  activeBuffer,
  createUntitledDocument,
  cycleDocumentEol,
  getDocumentBuffer,
  isDocumentDirty,
  openBuffers,
  openDocument,
  renameDocumentBuffer,
  selectDocument,
  restoreUntitledDrafts,
} = await import("../../../../../src/mainview/modules/editor/document/documentBuffers.ts");
const { activeId, clearSessionDocuments } =
  await import("../../../../../src/mainview/modules/editor/document/documentSession.ts");
const { bindFocusToWorkspace, clearFocusState, currentFocus } =
  await import("../../../../../src/mainview/modules/workspace/focus/focusState");
const { patchSettings, settings } =
  await import("../../../../../src/mainview/modules/settings/settingsStore.ts");

afterEach(() => {
  closeAllDocuments(true);
  clearSessionDocuments();
  clearFocusState();
  bindFocusToWorkspace(null);
  models.length = 0;
  draftPuts.length = 0;
  draftDeletes.length = 0;
  draftIdSeq = 0;
  listedDrafts = [];
  listDraftsShouldFail = false;
  changeMarkerCalls.bind.length = 0;
  changeMarkerCalls.reset.length = 0;
  changeMarkerCalls.dispose = 0;
  changeMarkerCalls.schedule = 0;
  nextSaveAsResult = {
    status: "saved",
    absolutePath: "/workspace/saved.md",
    mtimeMs: 2,
    grantToken: "grant-1",
  };
  rewriteHook = null;
  writeGate = null;
  saveAsGate = null;
  writeHook = null;
  readHook = null;
  lastWrittenContent = "";
  lastWrittenPath = "";
  nextReadContent = null;
  patchSettings({ editor: { ...settings.value.editor, defaultEol: "lf" } });
});

// Intent: protect model identity, disposal, virtual documents, Focus pairing,
// dirty-version semantics, and cross-platform EOL.
describe("document buffers", () => {
  test("reuses models, pairs Focus via selectDocument, and tracks dirty virtual tabs", async () => {
    const first = await openDocument("/workspace", "one.md");
    const sameFirst = await openDocument("/workspace", "one.md");
    const second = await openDocument("/workspace", "two.md");

    expect(sameFirst).toBe(first);
    expect(openBuffers.value).toHaveLength(2);
    expect(models).toHaveLength(2);

    expect(closeDocument("/workspace", "one.md", true)).toBe(true);
    expect((first.model as unknown as FakeModel).disposed).toBe(true);
    expect(getDocumentBuffer("/workspace", "one.md")).toBeNull();
    expect(openBuffers.value).toHaveLength(1);
    expect(activeBuffer.value).toBe(second);

    expect(closeDocument("/workspace", "two.md", true)).toBe(true);
    expect((second.model as unknown as FakeModel).disposed).toBe(true);
    expect(openBuffers.value).toHaveLength(0);

    const untitled = createUntitledDocument();
    expect(untitled.id.startsWith("untitled:")).toBe(true);
    expect((untitled.model as unknown as FakeModel).language).toBe("mdx");
    expect(untitled.rootPath).toBeNull();
    expect(activeId.value).toBe(untitled.id);
    expect(currentFocus.value).toBeNull();

    const fromTemplate = createUntitledDocument("# Note\n\n");
    expect(fromTemplate.model.getValue()).toBe("# Note\n\n");
    expect(isDocumentDirty(fromTemplate)).toBe(true);
    expect(fromTemplate.kind).toBe("virtual");

    bindFocusToWorkspace("/workspace");
    const folderFirst = await openDocument("/workspace", "one.md");
    expect(activeId.value).toBe(folderFirst.id);
    expect(currentFocus.value).toEqual({ path: "one.md", workspacePath: "/workspace" });

    const folderSecond = await openDocument("/workspace", "two.md");
    expect(currentFocus.value).toEqual({ path: "two.md", workspacePath: "/workspace" });

    const virtual = createUntitledDocument();
    expect(activeId.value).toBe(virtual.id);
    expect(currentFocus.value).toBeNull();

    expect(selectDocument(folderFirst.id)).toBe(true);
    expect(activeId.value).toBe(folderFirst.id);
    expect(currentFocus.value).toEqual({ path: "one.md", workspacePath: "/workspace" });

    expect(selectDocument(folderSecond.id)).toBe(true);
    expect(currentFocus.value).toEqual({ path: "two.md", workspacePath: "/workspace" });

    folderSecond.model.setValue("# edited");
    expect(isDocumentDirty(folderSecond)).toBe(true);

    writeHook = () => {
      throw new Error("fulvid.fs:operationFailed");
    };
    await expect(saveDocument(folderSecond)).rejects.toThrow("operationFailed");
    expect(isDocumentDirty(folderSecond)).toBe(true);
    expect(folderSecond.model.getValue()).toBe("# edited");

    writeHook = () => {
      folderSecond.model.setValue("# second");
    };
    folderSecond.model.setValue("# first");
    await saveDocument(folderSecond);
    expect(isDocumentDirty(folderSecond)).toBe(true);
    expect(folderSecond.model.getValue()).toBe("# second");
  });

  test("document EOL follows the model, not the operating system, and writes only on save", async () => {
    patchSettings({ editor: { ...settings.value.editor, defaultEol: "crlf" } });
    const untitled = createUntitledDocument();
    expect(untitled.model.getEOL()).toBe("\r\n");
    expect(isDocumentDirty(untitled)).toBe(false);

    cycleDocumentEol(untitled);
    expect(untitled.model.getEOL()).toBe("\n");
    expect(isDocumentDirty(untitled)).toBe(true);

    patchSettings({ editor: { ...settings.value.editor, defaultEol: "lf" } });
    nextReadContent = "alpha\r\nbeta\r\n";
    const opened = await openDocument("/workspace", "crlf.md");
    expect(opened.model.getEOL()).toBe("\r\n");
    expect(opened.model.getValue()).toBe("alpha\r\nbeta\r\n");
    expect(isDocumentDirty(opened)).toBe(false);

    await saveDocument(opened);
    expect(lastWrittenContent).toBe("alpha\r\nbeta\r\n");

    cycleDocumentEol(opened);
    expect(opened.model.getEOL()).toBe("\n");
    expect(isDocumentDirty(opened)).toBe(true);
    await saveDocument(opened);
    expect(lastWrittenContent).toBe("alpha\nbeta\n");
  });

  test("background rename keeps dirty text and does not steal the active tab or Focus", async () => {
    bindFocusToWorkspace("/workspace");
    const active = await openDocument("/workspace", "active.md");
    const background = await openDocument("/workspace", "background.md");
    background.model.setValue("# dirty rename");
    expect(isDocumentDirty(background)).toBe(true);

    expect(selectDocument(active.id)).toBe(true);
    expect(activeId.value).toBe(active.id);
    expect(currentFocus.value).toEqual({ path: "active.md", workspacePath: "/workspace" });

    renameDocumentBuffer(background, "renamed.md", 9);

    expect(activeId.value).toBe(active.id);
    expect(currentFocus.value).toEqual({ path: "active.md", workspacePath: "/workspace" });
    expect(getDocumentBuffer("/workspace", "background.md")).toBeNull();
    const renamed = getDocumentBuffer("/workspace", "renamed.md");
    expect(renamed).not.toBeNull();
    expect(renamed?.model.getValue()).toBe("# dirty rename");
    expect(isDocumentDirty(renamed!)).toBe(true);
  });

  test("awaitBufferWrites drains an in-flight save to the captured path", async () => {
    bindFocusToWorkspace("/workspace");
    const buffer = await openDocument("/workspace", "pending.md");
    buffer.model.setValue("# saving");

    let releaseWrite!: () => void;
    writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    let writeStarted = false;
    writeHook = () => {
      writeStarted = true;
    };

    const saving = saveDocument(buffer);
    await Promise.resolve();
    expect(writeStarted).toBe(true);
    expect(isDocumentDirty(buffer)).toBe(true);

    const drained = awaitBufferWrites(buffer);
    releaseWrite();
    await drained;
    await saving;

    expect(lastWrittenPath).toBe("pending.md");
    expect(lastWrittenContent).toBe("# saving");
    expect(isDocumentDirty(buffer)).toBe(false);
    await awaitAllBufferWrites();
  });

  test("abandoned async save races cannot reidentify buffers or clear replacement dirty state", async () => {
    const untitled = createUntitledDocument("# draft\n");
    const untitledId = untitled.id;

    let releaseDialog!: () => void;
    saveAsGate = new Promise<void>((resolve) => {
      releaseDialog = resolve;
    });

    const savingAs = saveAsDocument(untitled, "draft.md", "md");
    await Promise.resolve();
    expect(closeDocumentById(untitledId, true)).toBe(true);
    expect(openBuffers.value.find((buffer) => buffer.id === untitledId)).toBeUndefined();

    releaseDialog();
    const outcome = await savingAs;
    expect(outcome.result.status).toBe("saved");
    // Abandoned buffer must not return as a reidentified open tab.
    expect(openBuffers.value).toHaveLength(0);
    expect(outcome.buffer.id).toBe(untitledId);

    bindFocusToWorkspace("/workspace");
    const original = await openDocument("/workspace", "race.md");
    original.model.setValue("# v1");

    let releaseWrite!: () => void;
    writeGate = new Promise<void>((resolve) => {
      releaseWrite = resolve;
    });
    const saving = saveDocument(original);
    await Promise.resolve();

    expect(closeDocument("/workspace", "race.md", true)).toBe(true);
    const replacement = await openDocument("/workspace", "race.md");
    replacement.model.setValue("# v2 edited");
    expect(isDocumentDirty(replacement)).toBe(true);

    releaseWrite();
    await saving.catch(() => undefined);
    await awaitBufferWrites(original);

    expect(isDocumentDirty(replacement)).toBe(true);
    expect(replacement.model.getValue()).toBe("# v2 edited");
    expect(lastWrittenPath).toBe("race.md");
    expect(lastWrittenContent).toBe("# v1");
  });

  test("draft recovery schedules, clears, restores numbered tabs, and fails closed on empty or broken storage", async () => {
    const untitled = createUntitledDocument("# notes\n");
    expect(draftPuts.some((entry) => entry.content === "# notes\n")).toBe(true);
    const recoveryId = draftPuts[0]?.recoveryId;
    expect(recoveryId).toBeTruthy();

    expect(closeDocumentById(untitled.id, false)).toBe(false);
    expect(draftDeletes).toEqual([]);
    expect(closeDocumentById(untitled.id, true)).toBe(true);
    expect(draftDeletes).toEqual([recoveryId]);

    draftPuts.length = 0;
    draftDeletes.length = 0;
    const toSave = createUntitledDocument("# save me\n");
    const saveRecoveryId = draftPuts[0]?.recoveryId;
    const outcome = await saveAsDocument(toSave, "saved.md", "md");
    expect(outcome.result.status).toBe("saved");
    expect(outcome.buffer.kind).toBe("persisted");
    expect(draftDeletes).toContain(saveRecoveryId);

    closeAllDocuments(true);
    changeMarkerCalls.bind.length = 0;
    listedDrafts = [
      { recoveryId: "keep-a", content: "# Alice\n", updatedAt: 1 },
      { recoveryId: "keep-b", content: "# Bob\n", updatedAt: 2 },
    ];
    await restoreUntitledDrafts();
    expect(openBuffers.value).toHaveLength(2);
    expect(openBuffers.value[0]?.model.getValue()).toBe("# Alice\n");
    expect(openBuffers.value[1]?.title).toBe("Untitled 2");
    expect(changeMarkerCalls.bind.some((entry) => entry.content === "# Alice\n")).toBe(true);

    closeAllDocuments(true);
    listedDrafts = [];
    await restoreUntitledDrafts();
    expect(openBuffers.value).toHaveLength(0);

    listDraftsShouldFail = true;
    await restoreUntitledDrafts();
    expect(openBuffers.value).toHaveLength(0);
    const stillWorks = createUntitledDocument("# still works\n");
    expect(stillWorks.model.getValue()).toBe("# still works\n");
    expect(stillWorks.kind).toBe("virtual");
  });

  test("change markers reset on successful save and dispose on close", async () => {
    bindFocusToWorkspace("/workspace");
    const buffer = await openDocument("/workspace", "note.md");
    changeMarkerCalls.reset.length = 0;
    buffer.model.setValue("# edited");
    await saveDocument(buffer);
    expect(changeMarkerCalls.reset).toEqual([{ content: "# edited" }]);

    changeMarkerCalls.reset.length = 0;
    buffer.model.setValue("# again");
    writeHook = () => {
      throw new Error("fulvid.fs:operationFailed");
    };
    await expect(saveDocument(buffer)).rejects.toThrow("operationFailed");
    expect(changeMarkerCalls.reset).toEqual([]);

    const untitled = createUntitledDocument("# x\n");
    const disposeBefore = changeMarkerCalls.dispose;
    expect(closeDocumentById(untitled.id, true)).toBe(true);
    expect(changeMarkerCalls.dispose).toBe(disposeBefore + 1);
  });
});
