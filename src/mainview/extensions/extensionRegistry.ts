/**
 * Mainview registry for discovered extensions.
 *
 * Holds host-validated DTOs and invokes existing owners (notify, untitled) or
 * a host-provided Lua invoker. Not a lifecycle owner, filesystem authority, or
 * second command bus.
 */
import { ref, type Ref } from "vue";

import { expandTemplateDateTokens } from "../modules/editor/document/documentTemplates";
import {
  assertEditorReplaceWithinLimit,
  assertEditorSelectionWithinLimit,
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
  editor?: { selection: string };
};

export type ExtensionHostActions = {
  notify: (message: string) => void;
  createUntitled: (content: string) => void | Promise<void>;
  /** Bun host RPC — required to run Lua-registered commands from the renderer. */
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
    throw new Error("Extension host actions are not configured");
  }

  const { extension, command } = match;
  if (command.action === "lua") {
    if (!hostActions.invokeLuaCommand) {
      throw new Error("Lua extension invoker is not configured");
    }

    const request: ExtensionLuaInvokeRequest = { namespacedId };
    const wantsEditor = extension.capabilities.includes("editor");
    if (wantsEditor) {
      const seam = editorExtensionSeam();
      const selection = seam?.getSelection() ?? "";
      const selectionError = assertEditorSelectionWithinLimit(selection);
      if (selectionError) {
        throw new Error(selectionError);
      }
      request.editor = { selection };
    }

    const result = await hostActions.invokeLuaCommand(request);
    if (!result.ok) {
      throw new Error(result.error);
    }

    if (result.editor?.replaceSelection !== undefined) {
      if (!wantsEditor) {
        throw new Error("editor mutation without editor capability");
      }
      const replaceError = assertEditorReplaceWithinLimit(result.editor.replaceSelection);
      if (replaceError) {
        throw new Error(replaceError);
      }
      const seam = editorExtensionSeam();
      if (!seam?.hasActiveEditor() || !seam.replaceSelection(result.editor.replaceSelection)) {
        throw new Error("no active editor");
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
      throw new Error(`Extension template missing: ${command.template ?? ""}`);
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
