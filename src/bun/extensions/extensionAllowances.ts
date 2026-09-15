/**
 * Explicit user consent for blocked/failed extension packs.
 *
 * Stored on the Bun host under userData - never inferred from menus or Settings
 * navigation. Discovery consults this list only when attempting a consented load.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { isValidExtensionId } from "../../mainview/extensions/extensionManifest";

const MAX_ALLOWED = 64;
const STORAGE_NAME = "extension-allowances.json";

let storageDirectory: string | null = null;
let cachedIds: string[] | null = null;

export function configureExtensionAllowances(directory: string): void {
  storageDirectory = directory;
  cachedIds = null;
}

function storagePath(): string | null {
  if (!storageDirectory) {
    return null;
  }
  try {
    mkdirSync(storageDirectory, { recursive: true });
  } catch {
    return null;
  }
  return join(storageDirectory, STORAGE_NAME);
}

function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const ids: string[] = [];
  for (const entry of value) {
    if (typeof entry !== "string" || !isValidExtensionId(entry) || ids.includes(entry)) {
      continue;
    }
    ids.push(entry);
    if (ids.length >= MAX_ALLOWED) {
      break;
    }
  }
  return ids;
}

function loadAllowedIds(): string[] {
  if (cachedIds) {
    return cachedIds;
  }
  const path = storagePath();
  if (!path) {
    cachedIds = [];
    return cachedIds;
  }
  try {
    cachedIds = sanitize(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    cachedIds = [];
  }
  return cachedIds;
}

function persist(ids: string[]): void {
  cachedIds = ids;
  const path = storagePath();
  if (!path) {
    return;
  }
  try {
    writeFileSync(path, `${JSON.stringify(ids)}\n`, "utf8");
  } catch (error) {
    console.warn("Could not persist extension allowances:", error);
  }
}

export function listAllowedBlockedExtensionIds(): readonly string[] {
  return loadAllowedIds();
}

export function isBlockedExtensionAllowed(id: string): boolean {
  return loadAllowedIds().includes(id);
}

/** Record explicit consent to attempt loading a blocked/failed pack. */
export function allowBlockedExtension(id: string): boolean {
  if (!isValidExtensionId(id)) {
    return false;
  }
  const current = loadAllowedIds();
  if (current.includes(id)) {
    return true;
  }
  if (current.length >= MAX_ALLOWED) {
    return false;
  }
  persist([...current, id]);
  return true;
}

export function resetExtensionAllowancesForTests(): void {
  storageDirectory = null;
  cachedIds = null;
}
