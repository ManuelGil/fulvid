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
let nextReadContent: string | null = null;
let rewriteHook: (() => void) | null = null;
let saveAsHook: (() => void) | null = null;
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
  writeDocument: async (_rootPath: string, _path: string, content: string) => {
    lastWrittenContent = content;
    const hook = writeHook;
    writeHook = null;
    hook?.();
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
    saveAsHook?.();
    saveAsHook = null;
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
  closeAllDocuments,
  saveDocument,
  closeDocument,
  activeBuffer,
  createUntitledDocument,
  cycleDocumentEol,
  getDocumentBuffer,
  isDocumentDirty,
  openBuffers,
  openDocument,
} = await import("../../../../../src/mainview/modules/editor/document/documentBuffers.ts");
const { activeId, clearSessionDocuments } =
  await import("../../../../../src/mainview/modules/editor/document/documentSession.ts");
const { currentFocus } =
  await import("../../../../../src/mainview/modules/workspace/focus/focusState");
const { patchSettings, settings } =
  await import("../../../../../src/mainview/modules/settings/settingsStore.ts");

afterEach(() => {
  closeAllDocuments(true);
  clearSessionDocuments();
  models.length = 0;
  nextSaveAsResult = {
    status: "saved",
    absolutePath: "/workspace/saved.md",
    mtimeMs: 2,
    grantToken: "grant-1",
  };
  rewriteHook = null;
  saveAsHook = null;
  writeHook = null;
  readHook = null;
  lastWrittenContent = "";
  nextReadContent = null;
  patchSettings({ editor: { ...settings.value.editor, defaultEol: "lf" } });
});

// Intent: protect model identity, disposal, virtual documents, and dirty-version semantics.
// Growth boundary: add cases only for new lifecycle transitions or races.
describe("document buffers", () => {
  test("reuses open models and disposes them during rapid open/close", async () => {
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
  });

  test("activates a virtual document without Focus", () => {
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
  });

  test("dirty state tracks failed saves and versions that were never written", async () => {
    const buffer = await openDocument("/workspace", "one.md");
    buffer.model.setValue("# edited");
    expect(isDocumentDirty(buffer)).toBe(true);

    writeHook = () => {
      throw new Error("fulvid.fs:operationFailed");
    };
    await expect(saveDocument(buffer)).rejects.toThrow("operationFailed");
    expect(isDocumentDirty(buffer)).toBe(true);
    expect(buffer.model.getValue()).toBe("# edited");

    writeHook = () => {
      buffer.model.setValue("# second");
    };
    buffer.model.setValue("# first");
    await saveDocument(buffer);
    expect(isDocumentDirty(buffer)).toBe(true);
    expect(buffer.model.getValue()).toBe("# second");
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
});
