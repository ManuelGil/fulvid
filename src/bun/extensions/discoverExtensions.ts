/**
 * Host discovery for extensions under userData/extensions.
 *
 * Startup preload: validate -> classify -> load only safe packs. Blocked/failed
 * packs stay unloaded until explicit user consent. Source of truth is the
 * filesystem. Invalid packs fail in isolation.
 */
import { mkdirSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { join } from "node:path";

import {
  EXTENSION_PACK_LIMITS,
  namespacedExtensionCommandId,
  validateExtensionManifest,
  type DiscoveredExtension,
  type DiscoveredExtensionCommand,
  type ExtensionDiscoveryResult,
  type ExtensionLoadFailure,
  type ExtensionLoadState,
  type ExtensionManifest,
} from "../../mainview/extensions/extensionManifest";
import {
  allowBlockedExtension,
  configureExtensionAllowances,
  isBlockedExtensionAllowed,
} from "./extensionAllowances";
import {
  LuaExtensionLoadError,
  loadLuaExtensionPack,
  resetLuaCommandStoreForTests,
  unloadLuaExtensionPack,
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
  configureExtensionAllowances(userDataPath);
  cachedDiscovery = null;
}

export function getDiscoveredExtensions(): ExtensionDiscoveryResult {
  return (
    cachedDiscovery ?? {
      loaded: [],
      failed: [],
      installed: [],
      extensionsRoot: extensionsRootPath,
    }
  );
}

export function getExtensionsRootPath(): string | null {
  return extensionsRootPath;
}

function boundReason(raw: string): string {
  const reason = raw.split(/\r?\n/, 1)[0]?.trim() || raw;
  return reason.length > 300 ? `${reason.slice(0, 300)}…` : reason;
}

function emptyResult(): ExtensionDiscoveryResult {
  return {
    loaded: [],
    failed: [],
    installed: [],
    extensionsRoot: extensionsRootPath,
  };
}

/**
 * Enumerate immediate child directories, validate manifests, preload safe Lua packs.
 * Continues after individual failures.
 */
export async function discoverExtensions(): Promise<ExtensionDiscoveryResult> {
  // Fresh discovery replaces prior Lua sessions - do not keep stale callbacks.
  resetLuaCommandStoreForTests();

  const root = extensionsRootPath;
  if (!root) {
    const empty = emptyResult();
    cachedDiscovery = empty;
    return empty;
  }

  const loaded: DiscoveredExtension[] = [];
  const failed: ExtensionLoadFailure[] = [];
  const installed: DiscoveredExtension[] = [];
  const seenIds = new Set<string>();

  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    console.error("Fulvid extension discovery failed:", error);
    const result = {
      loaded: [],
      failed: [{ id: ".", reason: "extensions directory unreadable" }],
      installed: [],
      extensionsRoot: root,
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
    const outcome = await preloadExtensionPack(packRoot, directoryName);
    if (seenIds.has(outcome.id) && outcome.state !== "blocked") {
      const duplicate: DiscoveredExtension = {
        ...outcome,
        state: "blocked",
        reason: "duplicate extension id",
        commands: [],
      };
      failed.push({ id: outcome.id, reason: "duplicate extension id" });
      installed.push(duplicate);
      console.warn(`Fulvid extension "${directoryName}" failed: duplicate extension id`);
      continue;
    }
    seenIds.add(outcome.id);
    installed.push(outcome);
    if (outcome.state === "loaded" || outcome.state === "allowed") {
      loaded.push(outcome);
    } else {
      failed.push({
        id: outcome.id,
        reason: outcome.reason ?? "extension unavailable",
      });
      if (outcome.reason) {
        console.warn(`Fulvid extension "${directoryName}" failed: ${outcome.reason}`);
      }
    }
  }

  const result = { loaded, failed, installed, extensionsRoot: root };
  cachedDiscovery = result;
  return result;
}

/**
 * Explicit consent path: record allowance and attempt to load one blocked/failed pack.
 * Does not reload the whole discovery set's Lua store for neighbors.
 */
export async function loadAllowedBlockedExtension(
  extensionId: string,
): Promise<ExtensionDiscoveryResult> {
  if (!allowBlockedExtension(extensionId)) {
    return getDiscoveredExtensions();
  }
  const root = extensionsRootPath;
  if (!root) {
    return getDiscoveredExtensions();
  }
  // Re-run full discovery so Lua store stays consistent with neighbors.
  return discoverExtensions();
}

class ExtensionPackError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ExtensionPackError";
  }
}

async function readManifest(packRoot: string): Promise<ExtensionManifest> {
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
  return validation.manifest;
}

async function preflightEntry(packRoot: string, manifest: ExtensionManifest): Promise<void> {
  if (!manifest.entry) {
    return;
  }
  const entryPath = join(packRoot, ...manifest.entry.split("/"));
  try {
    const entryStat = await stat(entryPath);
    if (!entryStat.isFile()) {
      throw new ExtensionPackError("entry is not a file");
    }
    if (entryStat.size > 64 * 1024) {
      throw new ExtensionPackError("entry exceeds budget");
    }
  } catch (error) {
    if (error instanceof ExtensionPackError) {
      throw error;
    }
    throw new ExtensionPackError("missing entry");
  }
}

function baseDiscovered(
  manifest: ExtensionManifest,
  packRoot: string,
  state: ExtensionLoadState,
  reason?: string,
): DiscoveredExtension {
  const discovered: DiscoveredExtension = {
    id: manifest.id,
    name: manifest.name,
    version: manifest.version,
    api: manifest.api,
    capabilities: [...manifest.capabilities],
    commands: [],
    location: packRoot,
    state,
    activation: manifest.activation ?? "command",
  };
  if (manifest.description !== undefined) {
    discovered.description = manifest.description;
  }
  if (manifest.author !== undefined) {
    discovered.author = manifest.author;
  }
  if (manifest.documentAction !== undefined) {
    discovered.documentAction = manifest.documentAction;
  }
  if (reason) {
    discovered.reason = reason;
  }
  return discovered;
}

function attachCommandPlacements(
  manifest: ExtensionManifest,
  luaCommands: readonly { commandId: string; namespacedId: string; title: string }[],
): DiscoveredExtensionCommand[] {
  const placements = new Map(
    (manifest.actions ?? []).map((action) => [action.id, action] as const),
  );
  const documentAction = manifest.documentAction;
  return luaCommands.map((command) => {
    const placement = placements.get(command.commandId);
    const entry: DiscoveredExtensionCommand = {
      id: command.commandId,
      namespacedId: command.namespacedId,
      title: placement?.title ?? command.title,
    };
    if (placement?.menu) {
      entry.menu = placement.menu;
    }
    if (placement?.order !== undefined) {
      entry.order = placement.order;
    }
    if (documentAction && command.commandId === documentAction) {
      entry.documentAction = true;
    }
    return entry;
  });
}

async function preloadExtensionPack(
  packRoot: string,
  directoryName: string,
): Promise<DiscoveredExtension> {
  let manifest: ExtensionManifest;
  try {
    manifest = await readManifest(packRoot);
    if (manifest.id !== directoryName) {
      throw new ExtensionPackError(
        `manifest id "${manifest.id}" does not match directory "${directoryName}"`,
      );
    }
    await preflightEntry(packRoot, manifest);
  } catch (error) {
    const reason = boundReason(
      error instanceof ExtensionPackError
        ? error.reason
        : error instanceof Error
          ? error.message
          : "unknown extension load error",
    );
    return {
      id: directoryName,
      name: directoryName,
      version: "",
      api: 0,
      capabilities: [],
      commands: [],
      location: packRoot,
      state: "blocked",
      reason,
      activation: "command",
    };
  }

  const allowed = isBlockedExtensionAllowed(manifest.id);
  // Safe packs preload automatically. Consent only gates retry of previously
  // failed loads when the allowlist already contains the id - first discovery
  // still attempts every preflight-safe pack.
  try {
    let commands: DiscoveredExtensionCommand[] = [];
    if (manifest.capabilities.includes("lua")) {
      const luaCommands = await loadLuaExtensionPack(packRoot, manifest);
      try {
        commands = attachCommandPlacements(manifest, luaCommands);
        // Fail closed: documentAction / action ids must match registered commands.
        if (manifest.documentAction) {
          const found = commands.some((command) => command.id === manifest.documentAction);
          if (!found) {
            throw new ExtensionPackError(
              `documentAction "${manifest.documentAction}" is not registered`,
            );
          }
        }
        for (const action of manifest.actions ?? []) {
          if (!commands.some((command) => command.id === action.id)) {
            throw new ExtensionPackError(`action "${action.id}" is not registered`);
          }
        }
      } catch (error) {
        unloadLuaExtensionPack(manifest.id);
        throw error;
      }
    }
    const state: ExtensionLoadState = allowed ? "allowed" : "loaded";
    return {
      ...baseDiscovered(manifest, packRoot, state),
      commands,
    };
  } catch (error) {
    // Roll back any partial Lua registrations for this pack via full store reset
    // only at discovery start; a mid-loop failure must not leave this pack's
    // commands executable. loadLuaExtensionPack already isolates on throw.
    const reason = boundReason(
      error instanceof ExtensionPackError
        ? error.reason
        : error instanceof LuaExtensionLoadError
          ? error.reason
          : error instanceof Error
            ? error.message
            : "unknown extension load error",
    );
    return baseDiscovered(manifest, packRoot, "failed", reason);
  }
}

/** Resolve an installed pack path only under the extensions root. */
export function resolveInstalledExtensionPath(extensionId: string): string | null {
  const root = extensionsRootPath;
  if (!root || !extensionId || extensionId.includes("/") || extensionId.includes("\\")) {
    return null;
  }
  const current = getDiscoveredExtensions().installed.find((entry) => entry.id === extensionId);
  if (!current) {
    return null;
  }
  // Containment: location must stay under the configured root.
  if (current.location !== join(root, extensionId)) {
    return null;
  }
  return current.location;
}

/** Test helper: reset cached discovery without touching disk. */
export function resetExtensionDiscoveryForTests(): void {
  extensionsRootPath = null;
  cachedDiscovery = null;
  resetLuaCommandStoreForTests();
}

// Re-export for typed callers that build namespaced ids in tests.
export { namespacedExtensionCommandId };
