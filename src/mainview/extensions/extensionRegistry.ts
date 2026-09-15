/**
 * Discovered extension commands -> Lua invoke -> apply through existing owners.
 * Plain orchestration; not a plugin manager.
 */
import { ref, type Ref } from "vue";

import { LocalizedError } from "../modules/workspace/filesystem/workspaceErrors";
import { i18n } from "../i18n";
import {
  assertEditorReplaceWithinLimit,
  editorSnapshotIsCurrent,
  type EditorSelectionSnapshot,
} from "./editorCapability";
import {
  assertCreateUntitledWithinLimit,
  documentSnapshotIsCurrent,
  type DocumentSnapshot,
} from "./documentCapability";
import { parseExtensionDecorationRanges } from "./decorationCapability";
import { editorExtensionSeam } from "./editorExtensionSeam";
import { LUA_EXTENSION_LIMITS } from "../../bun/extensions/lua/luaLimits";
import type {
  DiscoveredExtension,
  DiscoveredExtensionCommand,
  ExtensionDiscoveryResult,
} from "./extensionManifest";

/** Renderer/RPC DTO - styles stay string until apply re-validates. */
export type ExtensionLuaInvokeResult =
  | {
      ok: true;
      notifications: string[];
      editor?: { replaceSelection?: string };
      decorations?: {
        clear?: boolean;
        set?: Array<{
          startLine: number;
          startColumn: number;
          endLine: number;
          endColumn: number;
          style?: string;
          appearance?: {
            backgroundColor: string;
            color?: string;
            bold?: boolean;
            overviewColor?: string;
            glyph?: boolean;
          };
        }>;
      };
      createUntitled?: string;
      reveal?: { lineNumber: number; column: number };
    }
  | { ok: false; error: string };

export type ExtensionLuaInvokeRequest = {
  namespacedId: string;
  editor?: EditorSelectionSnapshot;
  document?: DocumentSnapshot;
};

export type ExtensionHostActions = {
  notify: (message: string) => void;
  createUntitled: (content: string) => void | Promise<void>;
  invokeLuaCommand: (request: ExtensionLuaInvokeRequest) => Promise<ExtensionLuaInvokeResult>;
};

let hostActions: ExtensionHostActions | null = null;

export const discoveredExtensions: Ref<ExtensionDiscoveryResult> = ref({
  loaded: [],
  failed: [],
  installed: [],
  extensionsRoot: null,
});

export function configureExtensionHostActions(actions: ExtensionHostActions): void {
  hostActions = actions;
}

export function setDiscoveredExtensions(result: ExtensionDiscoveryResult): void {
  discoveredExtensions.value = {
    loaded: result.loaded ?? [],
    failed: result.failed ?? [],
    installed: result.installed ?? result.loaded ?? [],
    extensionsRoot: result.extensionsRoot ?? null,
  };
}

export function listExtensionCommands(): readonly DiscoveredExtensionCommand[] {
  return discoveredExtensions.value.loaded.flatMap((extension) => extension.commands);
}

/** Menu-facing actions only (excludes document always-on commands). */
export function listExtensionMenuCommands(): readonly DiscoveredExtensionCommand[] {
  return listExtensionCommands().filter((command) => command.menu && !command.documentAction);
}

/** Document-oriented packs that should refresh when the active document changes. */
export function listDocumentActivationCommands(): readonly {
  extensionId: string;
  namespacedId: string;
}[] {
  const result: { extensionId: string; namespacedId: string }[] = [];
  for (const extension of discoveredExtensions.value.loaded) {
    if (extension.activation !== "document" || !extension.documentAction) {
      continue;
    }
    const command = extension.commands.find(
      (entry) => entry.id === extension.documentAction || entry.documentAction,
    );
    if (command) {
      result.push({ extensionId: extension.id, namespacedId: command.namespacedId });
    }
  }
  return result;
}

function findExtensionCommand(
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

function fail(key: string): LocalizedError {
  return new LocalizedError(i18n.global.t(key));
}

function describeInvokeFailure(error: string): LocalizedError {
  const lower = error.toLowerCase();
  if (lower.includes("timeout") || lower.includes("interrupted") || lower.includes("execution")) {
    return fail("extensions.executionTimeout");
  }
  if (lower.includes("not enough memory") || lower.includes("memory")) {
    return fail("extensions.memoryExceeded");
  }
  if (lower.includes("exceeds size limit") || lower.includes("exceeds range limit")) {
    return fail("extensions.sizeLimitExceeded");
  }
  return fail("extensions.commandFailed");
}

/**
 * Run a namespaced Lua extension command through host-owned apply only.
 * @returns true when a registered extension command handled the id
 */
export async function runExtensionCommand(
  namespacedId: string,
  options?: { silent?: boolean },
): Promise<boolean> {
  const match = findExtensionCommand(namespacedId);
  if (!match) {
    return false;
  }
  if (!hostActions) {
    throw fail("extensions.hostUnavailable");
  }

  const { extension } = match;
  const wantsEditor = extension.capabilities.includes("editor");
  const wantsDocument = extension.capabilities.includes("document");
  const wantsDecorations = extension.capabilities.includes("decorations");
  const request: ExtensionLuaInvokeRequest = { namespacedId };
  let editorSnapshot: EditorSelectionSnapshot | undefined;
  let documentSnapshot: DocumentSnapshot | undefined;

  const seam = editorExtensionSeam();
  if ((wantsEditor || wantsDecorations) && !seam?.hasActiveEditor()) {
    throw fail("extensions.noActiveEditor");
  }

  if (wantsEditor) {
    const context = seam?.getApplyContext() ?? null;
    if (!context) {
      throw fail("extensions.noActiveEditor");
    }
    if (context.selection.length > LUA_EXTENSION_LIMITS.maxEditorSelectionChars.value) {
      throw fail("extensions.sizeLimitExceeded");
    }
    editorSnapshot = context;
    request.editor = context;
  }

  if (wantsDocument || wantsDecorations) {
    const context = seam?.getDocumentContext() ?? null;
    if (wantsDecorations && !context) {
      throw fail("extensions.noActiveEditor");
    }
    if (context) {
      if (wantsDocument && context.text.length > LUA_EXTENSION_LIMITS.maxDocumentTextChars.value) {
        throw fail("extensions.sizeLimitExceeded");
      }
      documentSnapshot = context;
      request.document = context;
    } else if (wantsDocument) {
      documentSnapshot = {
        text: "",
        documentId: "",
        alternativeVersionId: -1,
        cursorLine: 1,
        cursorColumn: 1,
      };
      request.document = documentSnapshot;
    }
  }

  const result = await hostActions.invokeLuaCommand(request);
  if (!result.ok) {
    throw describeInvokeFailure(result.error);
  }

  // Validate the entire Bun DTO before any host side effect (fail closed).
  if (!Array.isArray(result.notifications)) {
    throw fail("extensions.commandFailed");
  }
  if (result.notifications.length > LUA_EXTENSION_LIMITS.maxNotificationsPerInvoke.value) {
    throw fail("extensions.sizeLimitExceeded");
  }
  for (const message of result.notifications) {
    if (
      typeof message !== "string" ||
      message.length > LUA_EXTENSION_LIMITS.maxNotifyMessageChars.value
    ) {
      throw fail("extensions.sizeLimitExceeded");
    }
  }

  let parsedDecorationRanges: ReturnType<typeof parseExtensionDecorationRanges> | null = null;
  if (result.decorations) {
    if (!wantsDecorations) {
      throw fail("extensions.commandFailed");
    }
    if (result.decorations.set) {
      // Re-parse at the renderer trust boundary (Bun DTO is untrusted here).
      parsedDecorationRanges = parseExtensionDecorationRanges(result.decorations.set);
      if (!parsedDecorationRanges.ok) {
        throw fail("extensions.commandFailed");
      }
    }
  }

  if (result.editor?.replaceSelection !== undefined) {
    if (!wantsEditor || !editorSnapshot) {
      throw fail("extensions.commandFailed");
    }
    if (assertEditorReplaceWithinLimit(result.editor.replaceSelection)) {
      throw fail("extensions.sizeLimitExceeded");
    }
  }

  if (result.reveal !== undefined) {
    if (!wantsDocument) {
      throw fail("extensions.commandFailed");
    }
    const maxPos = LUA_EXTENSION_LIMITS.maxRevealPosition.value;
    if (
      typeof result.reveal !== "object" ||
      result.reveal === null ||
      !Number.isInteger(result.reveal.lineNumber) ||
      !Number.isInteger(result.reveal.column) ||
      result.reveal.lineNumber < 1 ||
      result.reveal.column < 1 ||
      result.reveal.lineNumber > maxPos ||
      result.reveal.column > maxPos
    ) {
      throw fail("extensions.commandFailed");
    }
  }

  if (result.createUntitled !== undefined) {
    if (!wantsDocument) {
      throw fail("extensions.commandFailed");
    }
    if (assertCreateUntitledWithinLimit(result.createUntitled)) {
      throw fail("extensions.sizeLimitExceeded");
    }
  }

  const liveSeam = editorExtensionSeam();
  const hasDecorationMutation = Boolean(result.decorations?.clear || result.decorations?.set);

  if (hasDecorationMutation) {
    if (!documentSnapshot?.documentId) {
      throw fail("extensions.commandFailed");
    }
    if (!documentSnapshotIsCurrent(documentSnapshot, liveSeam?.getDocumentContext() ?? null)) {
      throw fail("extensions.editorStale");
    }
  }

  if (result.editor?.replaceSelection !== undefined) {
    if (!editorSnapshotIsCurrent(editorSnapshot!, liveSeam?.getApplyContext() ?? null)) {
      throw fail("extensions.editorStale");
    }
    if (
      !liveSeam?.hasActiveEditor() ||
      !liveSeam.replaceSelection(result.editor.replaceSelection)
    ) {
      throw fail("extensions.noActiveEditor");
    }
  }

  if (result.reveal !== undefined) {
    if (documentSnapshot?.documentId) {
      const liveDoc = liveSeam?.getDocumentContext() ?? null;
      if (!liveDoc || liveDoc.documentId !== documentSnapshot.documentId) {
        throw fail("extensions.editorStale");
      }
    }
    if (
      !liveSeam?.hasActiveEditor() ||
      !liveSeam.reveal(result.reveal.lineNumber, result.reveal.column)
    ) {
      throw fail("extensions.noActiveEditor");
    }
  }

  if (result.decorations) {
    if (result.decorations.clear && !liveSeam?.clearExtensionDecorations(extension.id)) {
      throw fail("extensions.noActiveEditor");
    }
    if (parsedDecorationRanges?.ok) {
      if (!liveSeam?.setExtensionDecorations(extension.id, parsedDecorationRanges.ranges)) {
        throw fail("extensions.noActiveEditor");
      }
    }
  }

  if (result.createUntitled !== undefined) {
    await hostActions.createUntitled(result.createUntitled);
  }

  if (!options?.silent) {
    for (const message of result.notifications) {
      hostActions.notify(message);
    }
  }
  return true;
}

export function resetExtensionRegistryForTests(): void {
  hostActions = null;
  discoveredExtensions.value = {
    loaded: [],
    failed: [],
    installed: [],
    extensionsRoot: null,
  };
}
