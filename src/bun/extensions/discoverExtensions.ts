/**
 * Discover and load packs from userData/extensions.
 * Filesystem is source of truth. Blocked packs stay unloaded until consent.
 * Install/uninstall mutate that same inventory - no package manager.
 */
import { mkdirSync } from "node:fs";
import { copyFile, lstat, mkdir, readdir, readFile, realpath, rename, rm } from "node:fs/promises";
import { basename, join, relative, resolve, sep } from "node:path";

import {
  EXTENSION_PACK_LIMITS,
  formatExtensionAuthor,
  isValidExtensionId,
  namespacedExtensionCommandId,
  validateExtensionManifest,
  type DiscoveredExtension,
  type DiscoveredExtensionCommand,
  type ExtensionDiscoveryResult,
  type ExtensionInstallResult,
  type ExtensionLoadFailure,
  type ExtensionLoadState,
  type ExtensionManifest,
  type ExtensionUninstallResult,
} from "../../mainview/extensions/extensionManifest";
import {
  allowBlockedExtension,
  configureExtensionAllowances,
  isBlockedExtensionAllowed,
  revokeBlockedExtensionAllowance,
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
  ExtensionInstallResult,
  ExtensionLoadFailure,
  ExtensionUninstallResult,
};

const STAGING_PREFIX = "_fulvid-staging-";
const MAX_PACK_FILES = 256;
const MAX_PACK_TOTAL_BYTES = 2 * 1024 * 1024;

let extensionsRootPath: string | null = null;
let cachedDiscovery: ExtensionDiscoveryResult | null = null;
let lifecycleGate: Promise<void> = Promise.resolve();

async function withLifecycleLock<T>(operation: () => Promise<T>): Promise<T> {
  const previous = lifecycleGate;
  let release!: () => void;
  lifecycleGate = new Promise((resolveGate) => {
    release = resolveGate;
  });
  await previous;
  try {
    return await operation();
  } finally {
    release();
  }
}

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
  return reason.length > 300 ? `${reason.slice(0, 300)}...` : reason;
}

function emptyResult(): ExtensionDiscoveryResult {
  return {
    loaded: [],
    failed: [],
    installed: [],
    extensionsRoot: extensionsRootPath,
  };
}

function isStagingDirectoryName(name: string): boolean {
  return name.startsWith(".") || name.startsWith(STAGING_PREFIX);
}

async function cleanupStaleStaging(root: string): Promise<void> {
  let entries: Array<{ name: string; isDirectory: () => boolean }>;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(STAGING_PREFIX)) {
      continue;
    }
    try {
      await rm(join(root, entry.name), { recursive: true, force: true });
    } catch (error) {
      console.warn(`Could not remove staging directory ${entry.name}:`, error);
    }
  }
}

/**
 * Enumerate immediate child directories, validate manifests, preload safe Lua packs.
 * Continues after individual failures.
 */
export async function discoverExtensions(): Promise<ExtensionDiscoveryResult> {
  return withLifecycleLock(async () => discoverExtensionsUnlocked());
}

async function discoverExtensionsUnlocked(): Promise<ExtensionDiscoveryResult> {
  // Fresh discovery replaces prior Lua sessions - do not keep stale callbacks.
  resetLuaCommandStoreForTests();

  const root = extensionsRootPath;
  if (!root) {
    const empty = emptyResult();
    cachedDiscovery = empty;
    return empty;
  }

  await cleanupStaleStaging(root);

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
    .filter((entry) => entry.isDirectory() && !isStagingDirectoryName(entry.name))
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
 */
export async function loadAllowedBlockedExtension(
  extensionId: string,
): Promise<ExtensionDiscoveryResult> {
  return withLifecycleLock(async () => {
    if (!allowBlockedExtension(extensionId)) {
      return getDiscoveredExtensions();
    }
    if (!extensionsRootPath) {
      return getDiscoveredExtensions();
    }
    return discoverExtensionsUnlocked();
  });
}

class ExtensionPackError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = "ExtensionPackError";
  }
}

function pathInsideRoot(candidate: string, root: string): boolean {
  const relativePath = relative(root, candidate);
  return relativePath === "" || (!relativePath.startsWith(`..${sep}`) && relativePath !== "..");
}

async function readManifest(packRoot: string): Promise<ExtensionManifest> {
  const manifestPath = join(packRoot, "manifest.json");
  let raw: string;
  try {
    const manifestStat = await lstat(manifestPath);
    if (manifestStat.isSymbolicLink()) {
      throw new ExtensionPackError("manifest must not be a symlink");
    }
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
  if (!pathInsideRoot(entryPath, packRoot)) {
    throw new ExtensionPackError("entry must stay inside the pack");
  }
  try {
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      throw new ExtensionPackError("entry must not be a symlink");
    }
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

async function copyPackNoFollow(
  sourceRoot: string,
  destRoot: string,
  counters: { files: number; bytes: number },
): Promise<void> {
  const sourceStat = await lstat(sourceRoot);
  if (sourceStat.isSymbolicLink()) {
    throw new ExtensionPackError("extension pack must not be a symlink");
  }
  if (!sourceStat.isDirectory()) {
    throw new ExtensionPackError("extension pack must be a directory");
  }
  await mkdir(destRoot, { recursive: true });
  const entries = await readdir(sourceRoot, { withFileTypes: true });
  for (const entry of entries) {
    const from = join(sourceRoot, entry.name);
    const to = join(destRoot, entry.name);
    if (entry.isSymbolicLink()) {
      throw new ExtensionPackError("extension pack must not contain symlinks");
    }
    if (entry.isDirectory()) {
      await copyPackNoFollow(from, to, counters);
      continue;
    }
    if (!entry.isFile()) {
      throw new ExtensionPackError("unsupported pack entry type");
    }
    counters.files += 1;
    if (counters.files > MAX_PACK_FILES) {
      throw new ExtensionPackError("extension pack has too many files");
    }
    const fileStat = await lstat(from);
    counters.bytes += fileStat.size;
    if (counters.bytes > MAX_PACK_TOTAL_BYTES) {
      throw new ExtensionPackError("extension pack exceeds size budget");
    }
    await copyFile(from, to);
  }
}

/**
 * Validate a candidate pack directory and install it under userData/extensions/<id>.
 * Picker ownership stays in the Bun RPC handler - this accepts only a host-owned path.
 */
export async function installExtensionFromDirectory(
  sourceDirectory: string,
): Promise<ExtensionInstallResult> {
  return withLifecycleLock(async () => {
    const discovery = () => getDiscoveredExtensions();
    const root = extensionsRootPath;
    if (!root) {
      return {
        status: "error",
        reason: "extensions directory unavailable",
        discovery: discovery(),
      };
    }

    let sourceReal: string;
    try {
      const sourceStat = await lstat(sourceDirectory);
      if (sourceStat.isSymbolicLink()) {
        return {
          status: "error",
          reason: "extension pack must not be a symlink",
          discovery: discovery(),
        };
      }
      if (!sourceStat.isDirectory()) {
        return {
          status: "error",
          reason: "extension pack must be a directory",
          discovery: discovery(),
        };
      }
      sourceReal = await realpath(sourceDirectory);
    } catch {
      return { status: "error", reason: "extension pack unreadable", discovery: discovery() };
    }

    const rootReal = await realpath(root).catch(() => root);
    if (sourceReal === rootReal || pathInsideRoot(sourceReal, rootReal)) {
      return {
        status: "error",
        reason: "cannot install from the extensions directory",
        discovery: discovery(),
      };
    }

    let manifest: ExtensionManifest;
    try {
      manifest = await readManifest(sourceReal);
      await preflightEntry(sourceReal, manifest);
    } catch (error) {
      const reason =
        error instanceof ExtensionPackError
          ? error.reason
          : error instanceof Error
            ? error.message
            : "invalid extension pack";
      return { status: "error", reason: boundReason(reason), discovery: discovery() };
    }

    const destination = join(root, manifest.id);
    try {
      await lstat(destination);
      return {
        status: "error",
        reason: `extension "${manifest.id}" is already installed`,
        discovery: discovery(),
      };
    } catch {
      // Destination must not exist.
    }

    const staging = join(root, `${STAGING_PREFIX}${manifest.id}-${crypto.randomUUID()}`);
    try {
      await copyPackNoFollow(sourceReal, staging, { files: 0, bytes: 0 });
      const stagedManifest = await readManifest(staging);
      if (stagedManifest.id !== manifest.id) {
        throw new ExtensionPackError("staged manifest identity drifted");
      }
      await preflightEntry(staging, stagedManifest);
      await rename(staging, destination);
    } catch (error) {
      await rm(staging, { recursive: true, force: true }).catch(() => undefined);
      await rm(destination, { recursive: true, force: true }).catch(() => undefined);
      const reason =
        error instanceof ExtensionPackError
          ? error.reason
          : error instanceof Error
            ? error.message
            : "extension install failed";
      return {
        status: "error",
        reason: boundReason(reason),
        discovery: await discoverExtensionsUnlocked(),
      };
    }

    const result = await discoverExtensionsUnlocked();
    return { status: "ok", id: manifest.id, discovery: result };
  });
}

/** Remove one installed pack directory and revoke its allowance, then rediscover. */
export async function uninstallExtensionPack(
  extensionId: string,
): Promise<ExtensionUninstallResult> {
  return withLifecycleLock(async () => {
    const discovery = () => getDiscoveredExtensions();
    if (!isValidExtensionId(extensionId)) {
      return { status: "error", reason: "invalid extension id", discovery: discovery() };
    }
    const root = extensionsRootPath;
    if (!root) {
      return {
        status: "error",
        reason: "extensions directory unavailable",
        discovery: discovery(),
      };
    }

    const packPath = join(root, extensionId);
    if (basename(packPath) !== extensionId || !pathInsideRoot(resolve(packPath), resolve(root))) {
      return { status: "error", reason: "invalid extension path", discovery: discovery() };
    }

    try {
      const packStat = await lstat(packPath);
      if (packStat.isSymbolicLink() || !packStat.isDirectory()) {
        return { status: "error", reason: "extension pack missing", discovery: discovery() };
      }
    } catch {
      return { status: "error", reason: "extension pack missing", discovery: discovery() };
    }

    unloadLuaExtensionPack(extensionId);

    try {
      await rm(packPath, { recursive: true, force: false });
    } catch (error) {
      const reason = boundReason(
        error instanceof Error ? error.message : "could not delete extension pack",
      );
      return {
        status: "error",
        reason,
        discovery: await discoverExtensionsUnlocked(),
      };
    }

    try {
      await lstat(packPath);
      return {
        status: "error",
        reason: "extension files still present after delete",
        discovery: await discoverExtensionsUnlocked(),
      };
    } catch {
      // Expected: path is gone.
    }

    if (!revokeBlockedExtensionAllowance(extensionId)) {
      return {
        status: "error",
        reason: "extension removed but allowance could not be cleared",
        discovery: await discoverExtensionsUnlocked(),
      };
    }

    return { status: "ok", discovery: await discoverExtensionsUnlocked() };
  });
}

function baseDiscovered(
  manifest: ExtensionManifest,
  packRoot: string,
  state: ExtensionLoadState,
  reason?: string,
): DiscoveredExtension {
  const discovered: DiscoveredExtension = {
    id: manifest.id,
    publisher: manifest.publisher,
    name: manifest.name,
    displayName: manifest.displayName,
    version: manifest.version,
    api: manifest.api,
    description: manifest.description,
    capabilities: [...manifest.capabilities],
    commands: [],
    location: packRoot,
    state,
    activation: manifest.activation ?? "command",
  };
  if (manifest.author !== undefined) {
    discovered.author = formatExtensionAuthor(manifest.author);
  }
  if (manifest.license !== undefined) {
    discovered.license = manifest.license;
  }
  if (manifest.homepage !== undefined) {
    discovered.homepage = manifest.homepage;
  }
  if (manifest.repository !== undefined) {
    discovered.repository = manifest.repository;
  }
  if (manifest.bugs !== undefined) {
    discovered.bugs = manifest.bugs;
  }
  if (manifest.keywords !== undefined) {
    discovered.keywords = [...manifest.keywords];
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
    const dot = directoryName.indexOf(".");
    return {
      id: directoryName,
      publisher: dot > 0 ? directoryName.slice(0, dot) : "unknown",
      name: dot > 0 ? directoryName.slice(dot + 1) : directoryName,
      displayName: directoryName,
      version: "0.0.0",
      api: 0,
      description: "",
      capabilities: [],
      commands: [],
      location: packRoot,
      state: "blocked",
      reason,
      activation: "command",
    };
  }

  const allowed = isBlockedExtensionAllowed(manifest.id);
  try {
    let commands: DiscoveredExtensionCommand[] = [];
    if (manifest.capabilities.includes("lua")) {
      const luaCommands = await loadLuaExtensionPack(packRoot, manifest);
      try {
        commands = attachCommandPlacements(manifest, luaCommands);
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
  if (current.location !== join(root, extensionId)) {
    return null;
  }
  return current.location;
}

/** Test helper: reset cached discovery without touching disk. */
export function resetExtensionDiscoveryForTests(): void {
  extensionsRootPath = null;
  cachedDiscovery = null;
  lifecycleGate = Promise.resolve();
  resetLuaCommandStoreForTests();
}

export { namespacedExtensionCommandId };
