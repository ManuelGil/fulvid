/**
 * Mainview registry for discovered extensions.
 *
 * Holds host-validated DTOs and invokes existing owners (notify, untitled) or
 * a host-provided Lua invoker. Not a lifecycle owner, filesystem authority, or
 * second command bus.
 */
import { ref, type Ref } from "vue";

import { expandTemplateDateTokens } from "../modules/editor/document/documentTemplates";
import { LocalizedError } from "../modules/workspace/filesystem/workspaceErrors";
import { i18n } from "../i18n";
import {
  assertEditorReplaceWithinLimit,
  assertEditorSelectionWithinLimit,
  editorSnapshotIsCurrent,
  type EditorSelectionSnapshot,
} from "./editorCapability";
import { editorExtensionSeam } from "./editorExtensionSeam";
import type {
  DiscoveredExtension,
  DiscoveredExtensionCommand,
  ExtensionDiscoveryResult,
  ExtensionLoadFailure,
} from "./extensionManifest";

export type ExtensionLuaInvokeResult =
  | {
      ok: true;
      notifications: string[];
      editor?: { replaceSelection?: string };
    }
  | { ok: false; error: string };

export type ExtensionLuaInvokeRequest = {
  namespacedId: string;
  editor?: EditorSelectionSnapshot;
};

export type ExtensionHostActions = {
  notify: (message: string) => void;
  createUntitled: (content: string) => void | Promise<void>;
  /** Bun host RPC - required to run Lua-registered commands from the renderer. */
  invokeLuaCommand?: (request: ExtensionLuaInvokeRequest) => Promise<ExtensionLuaInvokeResult>;
};

let hostActions: ExtensionHostActions | null = null;

/** Reactive discovery snapshot so menus recompute when packs load. */
export const discoveredExtensions: Ref<ExtensionDiscoveryResult> = ref({
  loaded: [],
  failed: [],
});

export function configureExtensionHostActions(actions: ExtensionHostActions): void {
  hostActions = actions;
}

export function setDiscoveredExtensions(result: ExtensionDiscoveryResult): void {
  discoveredExtensions.value = result;
}

export function listLoadedExtensions(): readonly DiscoveredExtension[] {
  return discoveredExtensions.value.loaded;
}

export function listExtensionLoadFailures(): readonly ExtensionLoadFailure[] {
  return discoveredExtensions.value.failed;
}

export function listExtensionCommands(): readonly DiscoveredExtensionCommand[] {
  return discoveredExtensions.value.loaded.flatMap((extension) => extension.commands);
}

export function findExtensionCommand(
  namespacedId: string,
): { extension: DiscoveredExtension; command: DiscoveredExtensionCommand } | null {
  for (const extension of discoveredExtensions.value.loaded) {
    const command = extension.commands.find((entry) => entry.namespacedId === namespacedId);
    if (command) {
      return { extension, command };
    }
  }
  return null;
}

function extensionLocalizedError(key: string): LocalizedError {
  return new LocalizedError(i18n.global.t(key));
}

/**
 * Map known Lua/runtime failure strings to user-facing copy without leaking
 * Wasm/Wasmoon internals as primary UX.
 */
export function describeExtensionInvokeFailure(error: string): LocalizedError {
  const lower = error.toLowerCase();
  if (lower.includes("timeout") || lower.includes("interrupted") || lower.includes("execution")) {
    return extensionLocalizedError("extensions.executionTimeout");
  }
  if (lower.includes("not enough memory") || lower.includes("memory")) {
    return extensionLocalizedError("extensions.memoryExceeded");
  }
  if (lower.includes("exceeds size limit")) {
    return extensionLocalizedError("extensions.sizeLimitExceeded");
  }
  return extensionLocalizedError("extensions.commandFailed");
}

/**
 * Run a namespaced extension command through host-owned actions only.
 * @returns true when a registered extension command handled the id
 */
export async function runExtensionCommand(namespacedId: string): Promise<boolean> {
  const match = findExtensionCommand(namespacedId);
  if (!match) {
    return false;
  }
  if (!hostActions) {
    throw extensionLocalizedError("extensions.hostUnavailable");
  }

  const { extension, command } = match;
  if (command.action === "lua") {
    if (!hostActions.invokeLuaCommand) {
      throw extensionLocalizedError("extensions.hostUnavailable");
    }

    const request: ExtensionLuaInvokeRequest = { namespacedId };
    const wantsEditor = extension.capabilities.includes("editor");
    let editorSnapshot: EditorSelectionSnapshot | undefined;
    if (wantsEditor) {
      const seam = editorExtensionSeam();
      const context = seam?.getApplyContext() ?? null;
      if (!context) {
        throw extensionLocalizedError("extensions.noActiveEditor");
      }
      const selectionError = assertEditorSelectionWithinLimit(context.selection);
      if (selectionError) {
        throw extensionLocalizedError("extensions.sizeLimitExceeded");
      }
      editorSnapshot = context;
      request.editor = context;
    }

    const result = await hostActions.invokeLuaCommand(request);
    if (!result.ok) {
      throw describeExtensionInvokeFailure(result.error);
    }

    if (result.editor?.replaceSelection !== undefined) {
      if (!wantsEditor || !editorSnapshot) {
        throw extensionLocalizedError("extensions.commandFailed");
      }
      const replaceError = assertEditorReplaceWithinLimit(result.editor.replaceSelection);
      if (replaceError) {
        throw extensionLocalizedError("extensions.sizeLimitExceeded");
      }
      const seam = editorExtensionSeam();
      const live = seam?.getApplyContext() ?? null;
      if (!editorSnapshotIsCurrent(editorSnapshot, live)) {
        throw extensionLocalizedError("extensions.editorStale");
      }
      if (!seam?.hasActiveEditor() || !seam.replaceSelection(result.editor.replaceSelection)) {
        throw extensionLocalizedError("extensions.noActiveEditor");
      }
    }

    for (const message of result.notifications) {
      hostActions.notify(message);
    }
    return true;
  }

  if (command.action === "notify") {
    hostActions.notify(command.message ?? "");
    return true;
  }

  if (command.action === "createUntitledFromTemplate") {
    const template = extension.templates.find((entry) => entry.id === command.template);
    if (!template) {
      throw extensionLocalizedError("extensions.templateMissing");
    }
    await hostActions.createUntitled(expandTemplateDateTokens(template.content));
    return true;
  }

  return false;
}

/** Reset registry state for unit tests. */
export function resetExtensionRegistryForTests(): void {
  hostActions = null;
  discoveredExtensions.value = { loaded: [], failed: [] };
}
