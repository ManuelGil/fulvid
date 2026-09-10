import { afterEach, describe, expect, mock, test } from "bun:test";

type FakeModel = {
  value: string;
  language: string;
  disposed: boolean;
  version: number;
  listeners: Set<() => void>;
  getAlternativeVersionId(): number;
  getValue(): string;
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
      content: `# ${path}`,
      mtimeMs: 1,
    };
  },
  writeDocument: async () => {
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
        tokens: 0,
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
      createModel: (value: string, language = "markdown") => {
        const model: FakeModel = {
          value,
          language,
          disposed: false,
          version: 1,
          listeners: new Set(),
          getAlternativeVersionId() {
            return this.version;
          },
          getValue() {
            return this.value;
          },
          setValue(nextValue) {
            this.value = nextValue;
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
  getDocumentBuffer,
  isDocumentDirty,
  openBuffers,
  openDocument,
} = await import("../../../../../src/mainview/modules/editor/document/documentBuffers.ts");
const { activeId, clearSessionDocuments } =
  await import("../../../../../src/mainview/modules/editor/document/documentSession.ts");
const { currentFocus } =
  await import("../../../../../src/mainview/modules/workspace/focus/focusState");

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

  test("a failed save leaves the document dirty", async () => {
    const buffer = await openDocument("/workspace", "one.md");
    buffer.model.setValue("# edited");
    expect(isDocumentDirty(buffer)).toBe(true);

    writeHook = () => {
      throw new Error("fulvid.fs:operationFailed");
    };
    await expect(saveDocument(buffer)).rejects.toThrow("operationFailed");

    // The work is still here and still marked unsaved: a save that did not
    // reach disk must never produce a clean buffer.
    expect(isDocumentDirty(buffer)).toBe(true);
    expect(buffer.model.getValue()).toBe("# edited");
  });

  test("a successful save clears dirty for exactly the version it wrote", async () => {
    const buffer = await openDocument("/workspace", "one.md");
    buffer.model.setValue("# first");

    // The person keeps typing while the write is actually in flight.
    writeHook = () => {
      buffer.model.setValue("# second");
    };
    await saveDocument(buffer);

    // The newer text was never written, so the buffer stays dirty for it.
    expect(isDocumentDirty(buffer)).toBe(true);
    expect(buffer.model.getValue()).toBe("# second");
  });
});
