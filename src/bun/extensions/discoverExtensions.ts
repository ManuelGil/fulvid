/**
 * Host discovery for extensions under userData/extensions.
 *
 * Source of truth is the filesystem. Invalid packs fail in isolation.
 * Packs with the `lua` capability load entry.lua through the Bun-host
 * wasmoon runtime (not the renderer).
 */
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  EXTENSION_PACK_LIMITS,
  validateExtensionManifest,
  type DiscoveredExtension,
  type DiscoveredExtensionCommand,
  type ExtensionDiscoveryResult,
  type ExtensionLoadFailure,
} from "../../mainview/extensions/extensionManifest";
import {
  LuaExtensionLoadError,
  loadLuaExtensionPack,
  resetLuaCommandStoreForTests,
} from "./lua/luaExtensionRuntime";

export type {
  DiscoveredExtension,
  DiscoveredExtensionCommand,
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

export function getDiscoveredExtensions(): ExtensionDiscoveryResult {
  return cachedDiscovery ?? { loaded: [], failed: [] };
}

/**
 * Enumerate immediate child directories, validate manifests, load Lua packs.
 * Continues after individual failures.
 */
export async function discoverExtensions(): Promise<ExtensionDiscoveryResult> {
  // Fresh discovery replaces prior Lua sessions - do not keep stale callbacks.
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
          : error instanceof LuaExtensionLoadError
            ? error.reason
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
    const manifestStat = await stat(manifestPath);
    if (!manifestStat.isFile()) {
      throw new ExtensionPackError("missing manifest.json");
    }
    if (manifestStat.size > EXTENSION_PACK_LIMITS.maxManifestBytes) {
      throw new ExtensionPackError("manifest exceeds budget");
    }
    raw = await readFile(manifestPath, "utf8");
  } catch (error) {
    if (error instanceof ExtensionPackError) {
      throw error;
    }
    throw new ExtensionPackError("missing manifest.json");
  }

  if (Buffer.byteLength(raw, "utf8") > EXTENSION_PACK_LIMITS.maxManifestBytes) {
    throw new ExtensionPackError("manifest exceeds budget");
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

  let commands: DiscoveredExtensionCommand[] = [];
  if (manifest.capabilities.includes("lua")) {
    const luaCommands = await loadLuaExtensionPack(packRoot, manifest);
    commands = luaCommands.map((command) => ({
      id: command.commandId,
      namespacedId: command.namespacedId,
      title: command.title,
    }));
  }

  const discovered: DiscoveredExtension = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    api: manifest.api,
    capabilities: [...manifest.capabilities],
    commands,
  };
  if (manifest.description !== undefined) {
    discovered.description = manifest.description;
  }
  return discovered;
}

/** Test helper: reset cached discovery without touching disk. */
export function resetExtensionDiscoveryForTests(): void {
  extensionsRootPath = null;
  cachedDiscovery = null;
  resetLuaCommandStoreForTests();
}
