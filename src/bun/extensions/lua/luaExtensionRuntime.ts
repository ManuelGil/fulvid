/**
 * Load entry.lua and invoke commands through an explicit capability bridge.
 * No generic host.call. Budgets via wasmoon hooks / Wasm memory max.
 */
import { readFile, stat } from "node:fs/promises";

import type { LuaEngine } from "wasmoon";

import {
  namespacedExtensionCommandId,
  type ExtensionManifest,
} from "../../../mainview/extensions/extensionManifest";
import type {
  EditorMutationRequest,
  EditorSelectionSnapshot,
} from "../../../mainview/extensions/editorCapability";
import type { DocumentSnapshot } from "../../../mainview/extensions/documentCapability";
import {
  parseExtensionDecorationRanges,
  type DecorationsMutationRequest,
} from "../../../mainview/extensions/decorationCapability";
import {
  assertCanonicallyContained,
  containedPath,
  WorkspaceBoundaryError,
} from "../../filesystem/security/workspacePaths";
import {
  createHardenedLuaEngine,
  describeLuaRuntimeFailure,
  runLuaSourceWithBudget,
} from "./luaEngine";
import { LUA_EXTENSION_LIMITS } from "./luaLimits";

export class LuaExtensionLoadError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "LuaExtensionLoadError";
  }
}

export type LuaRegisteredCommand = {
  extensionId: string;
  commandId: string;
  namespacedId: string;
  title: string;
  run: () => unknown;
};

export type LuaInvokeRequest = {
  namespacedId: string;
  editor?: EditorSelectionSnapshot;
  document?: DocumentSnapshot;
};

export type LuaInvokeResult =
  | {
      ok: true;
      notifications: string[];
      editor?: EditorMutationRequest;
      decorations?: DecorationsMutationRequest;
      createUntitled?: string;
      reveal?: { lineNumber: number; column: number };
    }
  | { ok: false; error: string };

const engines = new Map<string, { engine: LuaEngine; capabilities: readonly string[] }>();
const commands = new Map<string, LuaRegisteredCommand>();

/** Protects partial registration if entry.lua fails mid-load. */
let loadTxn: { extensionId: string; pending: LuaRegisteredCommand[] } | null = null;
/** Rejects overlapping invokes against the shared engine maps. */
let invoking = false;

const EMPTY_EDITOR: EditorSelectionSnapshot = {
  selection: "",
  documentId: "",
  alternativeVersionId: -1,
  startOffset: 0,
  endOffset: 0,
};

const EMPTY_DOCUMENT: DocumentSnapshot = {
  text: "",
  documentId: "",
  alternativeVersionId: -1,
  cursorLine: 1,
  cursorColumn: 1,
};

function closeEngine(engine: LuaEngine | null): void {
  if (!engine) {
    return;
  }
  try {
    engine.global.close();
  } catch {
    // best-effort
  }
}

function dropExtension(extensionId: string): void {
  const record = engines.get(extensionId);
  if (record) {
    closeEngine(record.engine);
    engines.delete(extensionId);
  }
  for (const [namespacedId, command] of commands) {
    if (command.extensionId === extensionId) {
      commands.delete(namespacedId);
    }
  }
}

/** Test helper: drop all Lua engines and registrations. */
export function resetLuaCommandStoreForTests(): void {
  for (const record of engines.values()) {
    closeEngine(record.engine);
  }
  engines.clear();
  commands.clear();
  loadTxn = null;
  invoking = false;
}

export function findLuaCommand(namespacedId: string): LuaRegisteredCommand | null {
  return commands.get(namespacedId) ?? null;
}

async function installBridge(
  engine: LuaEngine,
  extensionId: string,
  bridge: {
    allowRegister: boolean;
    onNotify: ((message: string) => void) | null;
    editor?: { snapshot: EditorSelectionSnapshot; mutations: EditorMutationRequest };
    document?: {
      snapshot: DocumentSnapshot;
      setUntitled: (text: string) => void;
      setReveal: (pos: { lineNumber: number; column: number }) => void;
    };
    decorations?: DecorationsMutationRequest;
  },
): Promise<void> {
  // Capability isolation: only expose tables granted for this call.
  await engine.doString("editor = nil; document = nil; decorations = nil");

  const seen = new Set<string>();

  engine.global.set("commands", {
    register(definition: { id?: unknown; title?: unknown; run?: unknown }): void {
      if (!bridge.allowRegister || !loadTxn || loadTxn.extensionId !== extensionId) {
        throw new Error("commands.register is only allowed during extension load");
      }
      if (typeof definition !== "object" || definition === null) {
        throw new Error("commands.register expects a table");
      }
      const id = definition.id;
      const title = definition.title;
      const run = definition.run;
      if (typeof id !== "string" || !/^[a-z][a-zA-Z0-9]*$/.test(id)) {
        throw new Error("invalid Lua command id");
      }
      if (typeof title !== "string" || title.trim().length === 0) {
        throw new Error("invalid Lua command title");
      }
      if (title.length > LUA_EXTENSION_LIMITS.maxCommandTitleChars.value) {
        throw new Error("command title exceeds size limit");
      }
      if (typeof run !== "function") {
        throw new Error("commands.register requires a run function");
      }
      if (seen.has(id)) {
        throw new Error(`duplicate command id: ${id}`);
      }
      if (loadTxn.pending.length >= LUA_EXTENSION_LIMITS.maxCommandsPerExtension.value) {
        throw new Error("command registration limit exceeded");
      }
      seen.add(id);
      loadTxn.pending.push({
        extensionId,
        commandId: id,
        namespacedId: namespacedExtensionCommandId(extensionId, id),
        title,
        run: run as () => unknown,
      });
    },
  });

  engine.global.set("ui", {
    notify(message: unknown): void {
      if (!bridge.onNotify) {
        throw new Error("ui.notify is not available during registration");
      }
      if (typeof message !== "string") {
        throw new Error("ui.notify requires a string");
      }
      if (message.length > LUA_EXTENSION_LIMITS.maxNotifyMessageChars.value) {
        throw new Error("ui.notify message exceeds size limit");
      }
      bridge.onNotify(message);
    },
  });

  if (bridge.editor) {
    const { snapshot, mutations } = bridge.editor;
    engine.global.set("editor", {
      getSelection: () => snapshot.selection,
      replaceSelection(text: unknown): void {
        if (typeof text !== "string") {
          throw new Error("editor.replaceSelection requires a string");
        }
        if (text.length > LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value) {
          throw new Error("editor.replaceSelection exceeds size limit");
        }
        mutations.replaceSelection = text;
      },
    });
  }

  if (bridge.document) {
    const { snapshot, setUntitled, setReveal } = bridge.document;
    engine.global.set("document", {
      getText: () => snapshot.text,
      getCursor: () => ({ line: snapshot.cursorLine, column: snapshot.cursorColumn }),
      reveal(line: unknown, column: unknown): void {
        const max = LUA_EXTENSION_LIMITS.maxRevealPosition.value;
        if (
          typeof line !== "number" ||
          typeof column !== "number" ||
          !Number.isInteger(line) ||
          !Number.isInteger(column) ||
          line < 1 ||
          column < 1 ||
          line > max ||
          column > max
        ) {
          throw new Error("document.reveal requires a bounded positive integer position");
        }
        setReveal({ lineNumber: line, column });
      },
      createUntitled(markdown: unknown): void {
        if (typeof markdown !== "string") {
          throw new Error("document.createUntitled requires a string");
        }
        if (markdown.length > LUA_EXTENSION_LIMITS.maxCreateUntitledChars.value) {
          throw new Error("document.createUntitled exceeds size limit");
        }
        setUntitled(markdown);
      },
    });
  }

  if (bridge.decorations) {
    const mutations = bridge.decorations;
    engine.global.set("decorations", {
      set(ranges: unknown): void {
        const list = Array.isArray(ranges)
          ? ranges
          : typeof ranges === "object" && ranges !== null
            ? Object.keys(ranges)
                .filter((key) => /^\d+$/.test(key))
                .map((key) => Number(key))
                .sort((a, b) => a - b)
                .map((index) => (ranges as Record<string, unknown>)[String(index)])
            : null;
        if (!list) {
          throw new Error("decorations.set requires an array");
        }
        const parsed = parseExtensionDecorationRanges(
          list.map((entry) => {
            if (typeof entry !== "object" || entry === null || Array.isArray(entry)) {
              throw new Error("decoration range must be an object");
            }
            const record = entry as Record<string, unknown>;
            return {
              startLine: record.startLine,
              startColumn: record.startColumn,
              endLine: record.endLine,
              endColumn: record.endColumn,
              style: record.style,
            };
          }),
        );
        if (!parsed.ok) {
          throw new Error(parsed.error);
        }
        mutations.set = parsed.ranges;
        mutations.clear = undefined;
      },
      clear(): void {
        mutations.clear = true;
        mutations.set = undefined;
      },
    });
  }
}

export async function loadLuaExtensionPack(
  packRoot: string,
  manifest: ExtensionManifest,
): Promise<readonly LuaRegisteredCommand[]> {
  if (!manifest.capabilities.includes("lua") || !manifest.entry) {
    throw new LuaExtensionLoadError("lua packs require lua capability and entry");
  }

  const relativeEntry = manifest.entry.replace(/\\/g, "/");
  if (!relativeEntry.endsWith(".lua") || relativeEntry.includes("\0")) {
    throw new LuaExtensionLoadError("invalid entry path");
  }

  let entryPath: string;
  try {
    entryPath = containedPath(packRoot, relativeEntry);
    await assertCanonicallyContained(packRoot, relativeEntry);
  } catch (error) {
    throw new LuaExtensionLoadError(
      error instanceof WorkspaceBoundaryError
        ? "entry path outside extension"
        : "invalid entry path",
    );
  }

  let entryStat;
  try {
    entryStat = await stat(entryPath);
  } catch {
    throw new LuaExtensionLoadError(`missing entry file: ${manifest.entry}`);
  }
  if (!entryStat.isFile() || entryStat.size > LUA_EXTENSION_LIMITS.maxSourceBytes.value) {
    throw new LuaExtensionLoadError(
      entryStat.isFile()
        ? "entry.lua exceeds size limit"
        : `entry is not a file: ${manifest.entry}`,
    );
  }

  const source = await readFile(entryPath, "utf8");
  if (
    Buffer.byteLength(source, "utf8") > LUA_EXTENSION_LIMITS.maxSourceBytes.value ||
    source.startsWith("\u001bLua") ||
    source.includes("\0")
  ) {
    throw new LuaExtensionLoadError(
      source.startsWith("\u001bLua") || source.includes("\0")
        ? "bytecode entry is not allowed"
        : "entry.lua exceeds size limit",
    );
  }

  if (loadTxn || invoking) {
    throw new LuaExtensionLoadError("Lua registration reentrancy is not allowed");
  }
  loadTxn = { extensionId: manifest.id, pending: [] };

  let engine: LuaEngine | null = null;
  try {
    engine = await createHardenedLuaEngine();
    await installBridge(engine, manifest.id, { allowRegister: true, onNotify: null });
    await runLuaSourceWithBudget(engine, source);

    const committed = loadTxn.pending;
    dropExtension(manifest.id);
    engines.set(manifest.id, { engine, capabilities: [...manifest.capabilities] });
    for (const command of committed) {
      commands.set(command.namespacedId, command);
    }
    loadTxn = null;
    return committed;
  } catch (error) {
    closeEngine(engine);
    loadTxn = null;
    if (error instanceof LuaExtensionLoadError) {
      throw error;
    }
    throw new LuaExtensionLoadError(describeLuaRuntimeFailure(error));
  }
}

export async function invokeLuaExtensionCommand(
  request: LuaInvokeRequest | string,
): Promise<LuaInvokeResult> {
  const namespacedId = typeof request === "string" ? request : request?.namespacedId;
  if (typeof namespacedId !== "string" || namespacedId.length === 0 || namespacedId.length > 256) {
    return { ok: false, error: "invalid invoke request" };
  }
  const editorSnapshot = typeof request === "string" ? undefined : request.editor;
  const documentSnapshot = typeof request === "string" ? undefined : request.document;

  if (editorSnapshot !== undefined) {
    if (
      typeof editorSnapshot !== "object" ||
      editorSnapshot === null ||
      typeof editorSnapshot.selection !== "string" ||
      typeof editorSnapshot.documentId !== "string" ||
      typeof editorSnapshot.alternativeVersionId !== "number" ||
      typeof editorSnapshot.startOffset !== "number" ||
      typeof editorSnapshot.endOffset !== "number"
    ) {
      return { ok: false, error: "invalid editor snapshot" };
    }
  }
  if (documentSnapshot !== undefined) {
    if (
      typeof documentSnapshot !== "object" ||
      documentSnapshot === null ||
      typeof documentSnapshot.text !== "string" ||
      typeof documentSnapshot.documentId !== "string" ||
      typeof documentSnapshot.alternativeVersionId !== "number" ||
      typeof documentSnapshot.cursorLine !== "number" ||
      typeof documentSnapshot.cursorColumn !== "number"
    ) {
      return { ok: false, error: "invalid document snapshot" };
    }
  }

  const command = commands.get(namespacedId);
  const record = command ? engines.get(command.extensionId) : undefined;
  if (!command || !record) {
    return { ok: false, error: command ? "lua session missing" : "unknown lua command" };
  }

  if (invoking || loadTxn) {
    return { ok: false, error: "lua invocation reentrancy is not allowed" };
  }

  const caps = record.capabilities;
  const allowEditor = caps.includes("editor");
  const allowDocument = caps.includes("document");
  const allowDecorations = caps.includes("decorations");

  if (editorSnapshot && !allowEditor) {
    return { ok: false, error: "editor capability not granted" };
  }
  if (documentSnapshot && !allowDocument && !allowDecorations) {
    return { ok: false, error: "document capability not granted" };
  }
  if (
    editorSnapshot &&
    editorSnapshot.selection.length > LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value
  ) {
    return { ok: false, error: "editor selection exceeds size limit" };
  }
  if (
    documentSnapshot &&
    allowDocument &&
    documentSnapshot.text.length > LUA_EXTENSION_LIMITS.maxDocumentTextChars.value
  ) {
    return { ok: false, error: "document text exceeds size limit" };
  }

  const notifications: string[] = [];
  const editorMutations: EditorMutationRequest = {};
  const decorationMutations: DecorationsMutationRequest = {};
  let createUntitled: string | undefined;
  let reveal: { lineNumber: number; column: number } | undefined;

  invoking = true;
  try {
    await installBridge(record.engine, command.extensionId, {
      allowRegister: false,
      onNotify: (message) => {
        if (notifications.length >= LUA_EXTENSION_LIMITS.maxNotificationsPerInvoke.value) {
          throw new Error("ui.notify count exceeds size limit");
        }
        notifications.push(message);
      },
      editor: allowEditor
        ? { snapshot: editorSnapshot ?? EMPTY_EDITOR, mutations: editorMutations }
        : undefined,
      document: allowDocument
        ? {
            snapshot: documentSnapshot ?? EMPTY_DOCUMENT,
            setUntitled: (text) => {
              createUntitled = text;
            },
            setReveal: (pos) => {
              reveal = pos;
            },
          }
        : undefined,
      decorations: allowDecorations ? decorationMutations : undefined,
    });

    const runOutcome = command.run();
    // Reject thenables so a hanging Promise cannot pin `invoking` forever.
    if (
      runOutcome !== null &&
      runOutcome !== undefined &&
      (typeof runOutcome === "object" || typeof runOutcome === "function") &&
      typeof (runOutcome as { then?: unknown }).then === "function"
    ) {
      return { ok: false, error: "async command results are not allowed" };
    }

    const result: Extract<LuaInvokeResult, { ok: true }> = { ok: true, notifications };
    if (allowEditor && editorMutations.replaceSelection !== undefined) {
      result.editor = { replaceSelection: editorMutations.replaceSelection };
    }
    if (allowDecorations && (decorationMutations.clear || decorationMutations.set)) {
      result.decorations = {
        ...(decorationMutations.clear ? { clear: true } : {}),
        ...(decorationMutations.set ? { set: decorationMutations.set } : {}),
      };
    }
    if (allowDocument && createUntitled !== undefined) {
      result.createUntitled = createUntitled;
    }
    if (allowDocument && reveal !== undefined) {
      result.reveal = reveal;
    }
    return result;
  } catch (error) {
    return { ok: false, error: describeLuaRuntimeFailure(error) };
  } finally {
    invoking = false;
  }
}
