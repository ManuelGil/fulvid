/**
 * Load entry.lua and run commands through an explicit capability bridge.
 * No generic host.call. Budgets come from wasmoon hooks and Wasm memory max.
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
import type { ExtensionInvokeFailureKind } from "../../../mainview/desktop/desktopRpc";
import {
  createHardenedLuaEngine,
  describeLuaRuntimeFailure,
  isLuaMemoryError,
  isLuaTimeoutError,
  runLuaSourceWithBudget,
} from "./luaEngine";
import { LUA_EXTENSION_LIMITS } from "./luaLimits";
import { renderExtensionTemplate } from "./extensionTemplateRender";

export class LuaExtensionLoadError extends Error {
  constructor(readonly reason: string) {
    // Keep Error.message identical to the bounded reason (no extra stack body).
    super(reason);
    this.name = "LuaExtensionLoadError";
  }
}

/** Host size-budget rejection; classified as sizeLimitExceeded without reading message text. */
class LuaSizeLimitError extends Error {
  readonly failureKind = "sizeLimitExceeded" as const;
  constructor(message: string) {
    super(message);
    this.name = "LuaSizeLimitError";
  }
}

type LuaInvokeFailure = {
  ok: false;
  error: string;
  failureKind: ExtensionInvokeFailureKind;
};

function invokeFailure(failureKind: ExtensionInvokeFailureKind, error: string): LuaInvokeFailure {
  return { ok: false, error, failureKind };
}

/**
 * Bridge helpers return authored English diagnostics. Size-budget messages are a
 * closed set so classification stays contract-based rather than locale/OS matching.
 */
function throwBridgeValidationError(message: string): never {
  if (
    message === "decorations.set exceeds range limit" ||
    message === "template variable count exceeds limit" ||
    message === "template variable value exceeds size limit" ||
    message === "template source exceeds size limit" ||
    message === "template output exceeds size limit"
  ) {
    throw new LuaSizeLimitError(message);
  }
  throw new Error(message);
}

/** Map a caught guest/host error to the narrow invoke failure contract. */
function failureFromCaughtError(error: unknown): LuaInvokeFailure {
  if (error instanceof LuaSizeLimitError) {
    return invokeFailure("sizeLimitExceeded", error.message);
  }
  if (isLuaTimeoutError(error)) {
    return invokeFailure("executionTimeout", describeLuaRuntimeFailure(error));
  }
  if (isLuaMemoryError(error)) {
    return invokeFailure("memoryExceeded", describeLuaRuntimeFailure(error));
  }
  return invokeFailure("commandFailed", describeLuaRuntimeFailure(error));
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
  | LuaInvokeFailure;

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

/**
 * Lua may pass a 1-based array as a table with numeric string keys.
 * Normalize to a dense JS array, or null when the value is not a list.
 */
function luaListArgument(value: unknown): unknown[] | null {
  if (Array.isArray(value)) {
    return [...(value as unknown[])];
  }
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const record = value as Record<string, unknown>;
  const indexes = Object.keys(record)
    .filter((key) => /^\d+$/.test(key))
    .map((key) => Number(key))
    .sort((left, right) => left - right);
  const list: unknown[] = [];
  for (const index of indexes) {
    list.push(record[String(index)]);
  }
  return list;
}

/** Drop a pack's engine and commands (failed load cleanup and uninstall). */
export function unloadLuaExtensionPack(extensionId: string): void {
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

/** Drop all Lua engines and registrations (rediscovery and test seams). */
export function resetLuaCommandStore(): void {
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
    templates?: boolean;
  },
): Promise<void> {
  // Capability isolation: only expose tables granted for this call.
  await engine.doString(
    "editor = nil; document = nil; decorations = nil; template = nil; clock = nil",
  );

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
        throw new LuaSizeLimitError("command title exceeds size limit");
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
        throw new LuaSizeLimitError("ui.notify message exceeds size limit");
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
          throw new LuaSizeLimitError("editor.replaceSelection exceeds size limit");
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
          throw new LuaSizeLimitError("document.createUntitled exceeds size limit");
        }
        setUntitled(markdown);
      },
    });
  }

  if (bridge.decorations) {
    const mutations = bridge.decorations;
    engine.global.set("decorations", {
      set(ranges: unknown): void {
        const list = luaListArgument(ranges);
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
              appearance: record.appearance,
            };
          }),
        );
        if (!parsed.ok) {
          throwBridgeValidationError(parsed.error);
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

  if (bridge.templates) {
    engine.global.set("template", {
      render(source: unknown, variables: unknown): string {
        const rendered = renderExtensionTemplate(source, variables);
        if (!rendered.ok) {
          throwBridgeValidationError(rendered.error);
        }
        return rendered.text;
      },
    });
  }

  // Generic UTC calendar date for any Lua pack (seed docs, timestamps, metadata).
  // Not a date subsystem; available without the templates capability.
  engine.global.set("clock", {
    isoDate(): string {
      return new Date().toISOString().slice(0, 10);
    },
  });
}

export async function loadLuaExtensionPack(
  packRoot: string,
  manifest: ExtensionManifest,
): Promise<readonly LuaRegisteredCommand[]> {
  if (!manifest.capabilities.includes("lua") || !manifest.entry) {
    throw new LuaExtensionLoadError("lua packs require lua capability and entry");
  }

  // Claim before any await so concurrent loads cannot both pass the gate.
  if (loadTxn || invoking) {
    throw new LuaExtensionLoadError("Lua registration reentrancy is not allowed");
  }
  loadTxn = { extensionId: manifest.id, pending: [] };

  try {
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
    if (!entryStat.isFile()) {
      throw new LuaExtensionLoadError(`entry is not a file: ${manifest.entry}`);
    }
    if (entryStat.size > LUA_EXTENSION_LIMITS.maxSourceBytes.value) {
      throw new LuaExtensionLoadError("entry.lua exceeds size limit");
    }

    const source = await readFile(entryPath, "utf8");
    if (source.startsWith("\u001bLua") || source.includes("\0")) {
      throw new LuaExtensionLoadError("bytecode entry is not allowed");
    }
    if (Buffer.byteLength(source, "utf8") > LUA_EXTENSION_LIMITS.maxSourceBytes.value) {
      throw new LuaExtensionLoadError("entry.lua exceeds size limit");
    }

    let engine: LuaEngine | null = null;
    try {
      engine = await createHardenedLuaEngine();
      await installBridge(engine, manifest.id, {
        allowRegister: true,
        onNotify: null,
        templates: manifest.capabilities.includes("templates"),
      });
      await runLuaSourceWithBudget(engine, source);

      const committed = loadTxn.pending;
      unloadLuaExtensionPack(manifest.id);
      engines.set(manifest.id, { engine, capabilities: [...manifest.capabilities] });
      for (const command of committed) {
        commands.set(command.namespacedId, command);
      }
      loadTxn = null;
      return committed;
    } catch (error) {
      closeEngine(engine);
      if (error instanceof LuaExtensionLoadError) {
        throw error;
      }
      throw new LuaExtensionLoadError(describeLuaRuntimeFailure(error));
    }
  } catch (error) {
    loadTxn = null;
    throw error;
  }
}

export async function invokeLuaExtensionCommand(
  request: LuaInvokeRequest | string,
): Promise<LuaInvokeResult> {
  const namespacedId = typeof request === "string" ? request : request?.namespacedId;
  if (typeof namespacedId !== "string" || namespacedId.length === 0 || namespacedId.length > 256) {
    return invokeFailure("commandFailed", "invalid invoke request");
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
      return invokeFailure("commandFailed", "invalid editor snapshot");
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
      return invokeFailure("commandFailed", "invalid document snapshot");
    }
  }

  const command = commands.get(namespacedId);
  const record = command ? engines.get(command.extensionId) : undefined;
  if (!command || !record) {
    return invokeFailure("commandFailed", command ? "lua session missing" : "unknown lua command");
  }

  if (invoking || loadTxn) {
    return invokeFailure("commandFailed", "lua invocation reentrancy is not allowed");
  }

  const caps = record.capabilities;
  const allowEditor = caps.includes("editor");
  const allowDocument = caps.includes("document");
  const allowDecorations = caps.includes("decorations");
  const allowTemplates = caps.includes("templates");

  if (editorSnapshot && !allowEditor) {
    return invokeFailure("commandFailed", "editor capability not granted");
  }
  if (documentSnapshot && !allowDocument && !allowDecorations) {
    return invokeFailure("commandFailed", "document capability not granted");
  }
  if (
    editorSnapshot &&
    editorSnapshot.selection.length > LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value
  ) {
    return invokeFailure("sizeLimitExceeded", "editor selection exceeds size limit");
  }
  if (
    documentSnapshot &&
    allowDocument &&
    documentSnapshot.text.length > LUA_EXTENSION_LIMITS.maxDocumentTextChars.value
  ) {
    return invokeFailure("sizeLimitExceeded", "document text exceeds size limit");
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
          throw new LuaSizeLimitError("ui.notify count exceeds size limit");
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
      templates: allowTemplates,
    });

    const runOutcome = command.run();
    // Reject thenables so a hanging Promise cannot pin `invoking` forever.
    if (
      runOutcome !== null &&
      runOutcome !== undefined &&
      (typeof runOutcome === "object" || typeof runOutcome === "function") &&
      typeof (runOutcome as { then?: unknown }).then === "function"
    ) {
      return invokeFailure("commandFailed", "async command results are not allowed");
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
    return failureFromCaughtError(error);
  } finally {
    invoking = false;
  }
}
