/**
 * Folder approvals for the Bun host process.
 *
 * A folder becomes usable only when the person chose it in a native dialog.
 * That approval is remembered here, on the privileged side, so reopening a
 * recent folder does not require trusting a path the renderer supplies: the
 * renderer may ask to reopen a folder, but it cannot invent one.
 *
 * These are persisted **folder approvals**, not session **document grants**.
 * Document grants (UUID token → one absolute path) live in `workspaceAuthority`.
 *
 * Intent only - which folders were approved, not what they contain. The host
 * entry point supplies the storage directory so this module stays free of the
 * Electrobun runtime and can be exercised directly.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** Approvals retained across sessions, newest first. */
const MAX_APPROVED_ROOTS = 32;
const MAX_PATH_LENGTH = 4096;

let storageDirectory: string | null = null;
let cachedRoots: string[] | null = null;

/** Point approvals at the host's user-data directory. Called once at startup. */
export function configureWorkspaceApprovals(directory: string): void {
  storageDirectory = directory;
  cachedRoots = null;
}

function approvalsPath(): string | null {
  if (!storageDirectory) {
    return null;
  }
  try {
    mkdirSync(storageDirectory, { recursive: true });
  } catch {
    // An unusable user-data directory costs the memory of past folders, never
    // the ability to open one now.
    return null;
  }
  return join(storageDirectory, "approved-folders.json");
}

function sanitize(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }
  const roots: string[] = [];
  for (const entry of value) {
    if (
      typeof entry !== "string" ||
      entry.length === 0 ||
      entry.length > MAX_PATH_LENGTH ||
      entry.includes("\0") ||
      roots.includes(entry)
    ) {
      continue;
    }
    roots.push(entry);
    if (roots.length >= MAX_APPROVED_ROOTS) {
      break;
    }
  }
  return roots;
}

function loadApprovedRoots(): string[] {
  if (cachedRoots) {
    return cachedRoots;
  }
  const path = approvalsPath();
  if (!path) {
    cachedRoots = [];
    return cachedRoots;
  }
  try {
    cachedRoots = sanitize(JSON.parse(readFileSync(path, "utf8")));
  } catch {
    // Missing, unreadable or corrupt: start from no approvals rather than
    // failing startup. The person re-picks the folder once.
    cachedRoots = [];
  }
  return cachedRoots;
}

function persist(roots: string[]): void {
  cachedRoots = roots;
  const path = approvalsPath();
  if (!path) {
    return;
  }
  try {
    writeFileSync(path, JSON.stringify(roots));
  } catch (error) {
    // An unwritable user-data directory must not block the folder itself; the
    // approval simply does not survive this session.
    console.warn("Could not persist folder approvals:", error);
  }
}

/**
 * Record a folder the person selected in a native dialog.
 *
 * `canonicalPath` must already be `canonicalRoot()` output. This store compares
 * strings; it does not canonicalize on read.
 */
export function approveWorkspaceRoot(canonicalPath: string): void {
  const existing = loadApprovedRoots().filter((root) => root !== canonicalPath);
  persist([canonicalPath, ...existing].slice(0, MAX_APPROVED_ROOTS));
}

/** True when this folder was approved through a native dialog before. */
export function isApprovedWorkspaceRoot(canonicalPath: string): boolean {
  return loadApprovedRoots().includes(canonicalPath);
}

/** Test seam: forget approvals and any configured storage. */
export function resetWorkspaceApprovals(): void {
  storageDirectory = null;
  cachedRoots = null;
}
