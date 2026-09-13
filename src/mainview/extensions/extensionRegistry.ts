/**
 * Mainview registry for discovered declarative extensions.
 *
 * Holds host-validated DTOs and invokes existing owners (notify, untitled).
 * Not a lifecycle owner, filesystem authority, or second command bus.
 */
import { ref, type Ref } from "vue";

import { expandTemplateDateTokens } from "../modules/editor/document/documentTemplates";
import type {
  DiscoveredExtension,
  DiscoveredExtensionCommand,
  ExtensionDiscoveryResult,
  ExtensionLoadFailure,
} from "./extensionManifest";

export type ExtensionHostActions = {
  notify: (message: string) => void;
  createUntitled: (content: string) => void | Promise<void>;
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
