/**
 * Host discovery for extensions under userData/extensions.
 *
 * Source of truth is the filesystem. Invalid packs fail in isolation.
 * Declarative packs stay data-only. Packs with the `lua` capability may load
 * entry.lua through the Bun-host wasmoon spike (not the renderer).
 */
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  namespacedExtensionCommandId,
  validateExtensionManifest,
  type DiscoveredExtension,
  type DiscoveredExtensionCommand,
  type DiscoveredExtensionTemplate,
  type ExtensionDiscoveryResult,
  type ExtensionLoadFailure,
  type ExtensionManifest,
} from "../../mainview/extensions/extensionManifest";
import {
  assertCanonicallyContained,
  containedPath,
  WorkspaceBoundaryError,
} from "../filesystem/security/workspacePaths";
import { resetLuaCommandStoreForTests } from "./lua/luaCommandStore";
import { LuaExtensionLoadError, loadLuaExtensionPack } from "./lua/luaExtensionRuntime";

export type {
  DiscoveredExtension,
  DiscoveredExtensionCommand,
  DiscoveredExtensionTemplate,
  ExtensionDiscoveryResult,
  ExtensionLoadFailure,
};

let extensionsRootPath: string | null = null;
let cachedDiscovery: ExtensionDiscoveryResult | null = null;

/** Configure `userData/extensions` (creates the directory if missing). */
export function configureExtensionDiscovery(userDataPath: string): void {
  extensionsRootPath = join(userDataPath, "extensions");
  mkdirSync(extensionsRootPath, { recursive: true });
  cachedDiscovery = null;
}

export function extensionDiscoveryRoot(): string | null {
  return extensionsRootPath;
}

export function getDiscoveredExtensions(): ExtensionDiscoveryResult {
  return cachedDiscovery ?? { loaded: [], failed: [] };
}

/**
 * Enumerate immediate child directories, validate manifests, load template
 * bodies. Continues after individual failures.
 */
export async function discoverExtensions(): Promise<ExtensionDiscoveryResult> {
  // Fresh discovery replaces prior Lua sessions — do not keep stale callbacks.
  resetLuaCommandStoreForTests();

  const root = extensionsRootPath;
  if (!root) {
    const empty = { loaded: [], failed: [] };
    cachedDiscovery = empty;
    return empty;
  }

  const loaded: DiscoveredExtension[] = [];
  const failed: ExtensionLoadFailure[] = [];
  const seenIds = new Set<string>();

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    console.error("Fulvid extension discovery failed:", error);
    const result = {
      loaded: [],
      failed: [{ id: ".", reason: "extensions directory unreadable" }],
    };
    cachedDiscovery = result;
    return result;
  }

  const directories = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort();

  for (const directoryName of directories) {
    const packRoot = join(root, directoryName);
    try {
      const discovered = await loadExtensionPack(packRoot, directoryName);
      if (seenIds.has(discovered.id)) {
        failed.push({ id: discovered.id, reason: "duplicate extension id" });
        continue;
      }
      seenIds.add(discovered.id);
      loaded.push(discovered);
    } catch (error) {
      const reason =
        error instanceof ExtensionPackError
          ? error.reason
          : error instanceof WorkspaceBoundaryError
            ? "template path outside extension"
            : error instanceof Error
              ? error.message
              : "unknown extension load error";
      failed.push({ id: directoryName, reason });
      console.warn(`Fulvid extension "${directoryName}" failed: ${reason}`);
    }
  }

  const result = { loaded, failed };
  cachedDiscovery = result;
  return result;
}

class ExtensionPackError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ExtensionPackError";
  }
}

async function loadExtensionPack(
  packRoot: string,
  directoryName: string,
): Promise<DiscoveredExtension> {
  const manifestPath = join(packRoot, "manifest.json");
  let raw: string;
  try {
    raw = await readFile(manifestPath, "utf8");
  } catch {
    throw new ExtensionPackError("missing manifest.json");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new ExtensionPackError("malformed manifest.json");
  }

  const validation = validateExtensionManifest(parsed);
  if ("reason" in validation) {
    throw new ExtensionPackError(validation.reason);
  }

  const manifest = validation.manifest;
  if (manifest.id !== directoryName) {
    throw new ExtensionPackError(
      `manifest id "${manifest.id}" does not match directory "${directoryName}"`,
    );
  }

  const templates = await loadTemplates(packRoot, manifest);
  let commands: DiscoveredExtensionCommand[] = (manifest.commands ?? []).map((command) => {
    const entry: DiscoveredExtensionCommand = {
      id: command.id,
      namespacedId: namespacedExtensionCommandId(manifest.id, command.id),
      title: command.title,
      action: command.action,
    };
    if (command.message !== undefined) {
      entry.message = command.message;
    }
    if (command.template !== undefined) {
      entry.template = command.template;
    }
    return entry;
  });

  if (manifest.capabilities.includes("lua")) {
    try {
      const luaCommands = await loadLuaExtensionPack(packRoot, manifest);
      commands = luaCommands.map((command) => ({
        id: command.commandId,
        namespacedId: command.namespacedId,
        title: command.title,
        action: "lua" as const,
      }));
    } catch (error) {
      if (error instanceof LuaExtensionLoadError) {
        throw new ExtensionPackError(error.reason);
      }
      throw error;
    }
  }

  const discovered: DiscoveredExtension = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    api: manifest.api,
    capabilities: [...manifest.capabilities],
    commands,
    templates,
  };
  if (manifest.description !== undefined) {
    discovered.description = manifest.description;
  }
  return discovered;
}

async function loadTemplates(
  packRoot: string,
  manifest: ExtensionManifest,
): Promise<DiscoveredExtensionTemplate[]> {
  const out: DiscoveredExtensionTemplate[] = [];
  for (const template of manifest.templates ?? []) {
    const relativeFile = template.file.replace(/\\/g, "/");
    const lexicalTarget = containedPath(packRoot, relativeFile);
    await assertCanonicallyContained(packRoot, relativeFile);

    let fileStat;
    try {
      fileStat = await stat(lexicalTarget);
    } catch {
      throw new ExtensionPackError(`missing template file: ${template.file}`);
    }
    if (!fileStat.isFile()) {
      throw new ExtensionPackError(`template is not a file: ${template.file}`);
    }
    if (!relativeFile.endsWith(".md") && !relativeFile.endsWith(".markdown")) {
      throw new ExtensionPackError(`template must be Markdown: ${template.file}`);
    }

    const content = await readFile(lexicalTarget, "utf8");
    out.push({
      id: template.id,
      name: template.name,
      content,
    });
  }
  return out;
}

/** Test helper: reset cached discovery without touching disk. */
export function resetExtensionDiscoveryForTests(): void {
  extensionsRootPath = null;
  cachedDiscovery = null;
  resetLuaCommandStoreForTests();
}
