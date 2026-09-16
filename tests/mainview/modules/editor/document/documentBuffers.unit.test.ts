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

  test("close during Save As dialog does not reidentify the abandoned buffer", async () => {
    const untitled = createUntitledDocument("# draft\n");
    const untitledId = untitled.id;

    let releaseDialog!: () => void;
    saveAsGate = new Promise<void>((resolve) => {
      releaseDialog = resolve;
    });

    const saving = saveAsDocument(untitled, "draft.md", "md");
    await Promise.resolve();
    expect(closeDocumentById(untitledId, true)).toBe(true);
    expect(openBuffers.value.find((buffer) => buffer.id === untitledId)).toBeUndefined();

    releaseDialog();
    const outcome = await saving;
    expect(outcome.result.status).toBe("saved");
    // Abandoned buffer must not return as a reidentified open tab.
    expect(openBuffers.value).toHaveLength(0);
    expect(outcome.buffer.id).toBe(untitledId);
  });

  test("abandoned in-flight save cannot clear dirty state on a replacement buffer", async () => {
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
});
