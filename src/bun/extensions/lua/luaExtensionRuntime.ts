/**
 * Load entry.lua in an isolated wasmoon engine and register commands through an
 * explicit capability bridge (never a generic host.call).
 *
 * Guest APIs: commands.register (load), ui.notify (invoke), and when the pack
 * declares `editor`: editor.getSelection / editor.replaceSelection (snapshot/apply).
 *
 * Runtime lives only in the Bun host. Defensive budgets: thread/function timeouts
 * and Wasm `setMemoryMax` (capability/resource limits — NOT an OS sandbox).
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
import {
  assertCanonicallyContained,
  containedPath,
  WorkspaceBoundaryError,
} from "../../filesystem/security/workspacePaths";
import {
  beginLuaRegistration,
  commitLuaRegistration,
  discardLuaRegistration,
  findLuaCommand,
  getLuaEngineForExtension,
  isLuaRegistering,
  luaExtensionHasCapability,
  pendingLuaCommandCount,
  queuePendingLuaCommand,
  type LuaRegisteredCommand,
} from "./luaCommandStore";
import {
  createHardenedLuaEngine,
  describeLuaRuntimeFailure,
  resetLuaFactoryForTests,
  runLuaSourceWithBudget,
} from "./luaEngine";
import { LUA_EXTENSION_LIMITS } from "./luaLimits";

export { resetLuaFactoryForTests };
export { resolveWasmoonGlueWasmPath } from "./luaEngine";

export class LuaExtensionLoadError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "LuaExtensionLoadError";
  }
}

export type LuaInvokeRequest = {
  namespacedId: string;
  editor?: EditorSelectionSnapshot;
};

export type LuaInvokeSuccess = {
  ok: true;
  notifications: string[];
  editor?: EditorMutationRequest;
};

export type LuaInvokeFailure = { ok: false; error: string };

export type LuaInvokeResult = LuaInvokeSuccess | LuaInvokeFailure;

function installCapabilityBridge(
  engine: LuaEngine,
  extensionId: string,
  options: {
    onNotify: (message: string) => void;
    allowRegister: boolean;
    allowNotify: boolean;
    editor?: {
      snapshot: EditorSelectionSnapshot;
      mutations: EditorMutationRequest;
    };
  },
): void {
  const seenIds = new Set<string>();

  engine.global.set("commands", {
    register(definition: { id?: unknown; title?: unknown; run?: unknown }): void {
      if (!options.allowRegister || !isLuaRegistering()) {
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
      if (typeof run !== "function") {
        throw new Error("commands.register requires a run function");
      }
      if (seenIds.has(id)) {
        throw new Error(`duplicate command id: ${id}`);
      }
      if (pendingLuaCommandCount() >= LUA_EXTENSION_LIMITS.maxCommandsPerExtension.value) {
        throw new Error("command registration limit exceeded");
      }
      seenIds.add(id);
      const command: LuaRegisteredCommand = {
        extensionId,
        commandId: id,
        namespacedId: namespacedExtensionCommandId(extensionId, id),
        title,
        run: run as () => unknown,
      };
      queuePendingLuaCommand(command);
    },
  });

  engine.global.set("ui", {
    notify(message: unknown): void {
      if (!options.allowNotify) {
        throw new Error("ui.notify is not available during registration");
      }
      if (typeof message !== "string") {
        throw new Error("ui.notify requires a string");
      }
      if (message.length > LUA_EXTENSION_LIMITS.maxNotifyMessageChars.value) {
        throw new Error("ui.notify message exceeds size limit");
      }
      options.onNotify(message);
    },
  });

  if (options.editor) {
    const { snapshot, mutations } = options.editor;
    engine.global.set("editor", {
      getSelection(): string {
        return snapshot.selection;
      },
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
}

/**
 * Load entry.lua for a lua-capable pack. Commits registrations only on success.
 * @returns committed command metadata for the discovery DTO
 */
export async function loadLuaExtensionPack(
  packRoot: string,
  manifest: ExtensionManifest,
): Promise<readonly LuaRegisteredCommand[]> {
  if (!manifest.capabilities.includes("lua")) {
    throw new LuaExtensionLoadError("lua capability required");
  }
  if (!manifest.entry) {
    throw new LuaExtensionLoadError("lua packs require entry");
  }

  const relativeEntry = manifest.entry.replace(/\\/g, "/");
  if (!relativeEntry.endsWith(".lua")) {
    throw new LuaExtensionLoadError("entry must be a .lua source file");
  }
  if (relativeEntry.includes("\0")) {
    throw new LuaExtensionLoadError("invalid entry path");
  }

  try {
    containedPath(packRoot, relativeEntry);
    await assertCanonicallyContained(packRoot, relativeEntry);
  } catch (error) {
    if (error instanceof WorkspaceBoundaryError) {
      throw new LuaExtensionLoadError("entry path outside extension");
    }
    throw new LuaExtensionLoadError("invalid entry path");
  }

  const entryPath = containedPath(packRoot, relativeEntry);

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
  if (Buffer.byteLength(source, "utf8") > LUA_EXTENSION_LIMITS.maxSourceBytes.value) {
    throw new LuaExtensionLoadError("entry.lua exceeds size limit");
  }
  // Reject Lua binary chunk signatures (bytecode).
  if (source.startsWith("\u001bLua") || source.includes("\0")) {
    throw new LuaExtensionLoadError("bytecode entry is not allowed");
  }

  let engine: LuaEngine | null = null;
  beginLuaRegistration(manifest.id, manifest.capabilities);
  try {
    engine = await createHardenedLuaEngine();
    installCapabilityBridge(engine, manifest.id, {
      allowRegister: true,
      allowNotify: false,
      onNotify: () => {
        throw new Error("ui.notify is not available during registration");
      },
    });
    await runLuaSourceWithBudget(engine, source);
    return commitLuaRegistration(engine);
  } catch (error) {
    discardLuaRegistration(engine);
    if (error instanceof LuaExtensionLoadError) {
      throw error;
    }
    throw new LuaExtensionLoadError(describeLuaRuntimeFailure(error));
  }
}

/**
 * Invoke a committed Lua command. Collects ui.notify messages and optional
 * editor.replaceSelection mutations for the renderer to apply.
 */
export async function invokeLuaExtensionCommand(
  request: LuaInvokeRequest | string,
): Promise<LuaInvokeResult> {
  const namespacedId = typeof request === "string" ? request : request.namespacedId;
  const editorSnapshot = typeof request === "string" ? undefined : request.editor;

  const command = findLuaCommand(namespacedId);
  if (!command) {
    return { ok: false, error: "unknown lua command" };
  }

  const engine = getLuaEngineForExtension(command.extensionId);
  if (!engine) {
    return { ok: false, error: "lua session missing" };
  }

  const allowEditor = luaExtensionHasCapability(command.extensionId, "editor");
  if (editorSnapshot && !allowEditor) {
    return { ok: false, error: "editor capability not granted" };
  }
  if (
    editorSnapshot &&
    editorSnapshot.selection.length > LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value
  ) {
    return { ok: false, error: "editor selection exceeds size limit" };
  }

  const notifications: string[] = [];
  const mutations: EditorMutationRequest = {};
  installCapabilityBridge(engine, command.extensionId, {
    allowRegister: false,
    allowNotify: true,
    onNotify: (message) => {
      notifications.push(message);
    },
    editor: allowEditor
      ? {
          snapshot: editorSnapshot ?? {
            selection: "",
            documentId: "",
            alternativeVersionId: -1,
            startOffset: 0,
            endOffset: 0,
          },
          mutations,
        }
      : undefined,
  });

  try {
    // Ensure packs without `editor` cannot see a leftover host table.
    if (!allowEditor) {
      await engine.doString("editor = nil");
    }
    await Promise.resolve(command.run());
    const result: LuaInvokeSuccess = { ok: true, notifications };
    if (allowEditor && mutations.replaceSelection !== undefined) {
      result.editor = { replaceSelection: mutations.replaceSelection };
    }
    return result;
  } catch (error) {
    return { ok: false, error: describeLuaRuntimeFailure(error) };
  }
}
