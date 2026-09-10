/**
 * Context derivation scoped to an active context root.
 * Deterministic path checks, scoped summaries, and per-folder persistence
 * of the chosen root.
 */
import type { ScannedNote } from "../../workspace/filesystem/workspaceTypes";
import { i18n } from "../../../i18n";

export const WORKSPACE_CONTEXT_ROOT = "";

const STORAGE_KEY = "fulvid.contextRoots";

interface ContextRootEntry {
  workspacePath: string;
  contextRoot: string;
}

function isContextRootEntry(value: unknown): value is ContextRootEntry {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return typeof candidate.workspacePath === "string" && typeof candidate.contextRoot === "string";
}

/** One notation for document counts everywhere: "1 document", "12 documents". */
export function formatDocumentCount(count: number): string {
  return i18n.global.t(count === 1 ? "context.oneDocument" : "context.manyDocuments", {
    count: count.toLocaleString(i18n.global.locale.value),
  });
}

export function normalizeContextRoot(contextRoot: string): string {
  return contextRoot.replace(/\\/g, "/").replace(/\/$/, "");
}

export function isPathWithinContext(notePath: string, contextRoot: string | null): boolean {
  if (contextRoot === null) {
    return false;
  }

  const root = normalizeContextRoot(contextRoot);
  const normalizedPath = notePath.replace(/\\/g, "/");

  if (!root) {
    return true;
  }

  return normalizedPath === root || normalizedPath.startsWith(`${root}/`);
}

export function pathRelativeToContext(notePath: string, contextRoot: string): string {
  const root = normalizeContextRoot(contextRoot);
  const normalizedPath = notePath.replace(/\\/g, "/");

  if (!root) {
    return normalizedPath;
  }

  if (normalizedPath === root) {
    return "";
  }

  if (normalizedPath.startsWith(`${root}/`)) {
    return normalizedPath.slice(root.length + 1);
  }

  return normalizedPath;
}

export function filterNotesByContextRoot(notes: ScannedNote[], contextRoot: string): ScannedNote[] {
  return notes.filter((note) => isPathWithinContext(note.path, contextRoot));
}

function readAll(): ContextRootEntry[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return [];
    }
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter(isContextRootEntry) : [];
  } catch {
    return [];
  }
}

function writeAll(entries: ContextRootEntry[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
}

export function getStoredContextRoot(workspacePath: string): string | null {
  const entry = readAll().find((item) => item.workspacePath === workspacePath);
  return entry?.contextRoot ?? null;
}

export function setStoredContextRoot(workspacePath: string, contextRoot: string): void {
  const normalized = normalizeContextRoot(contextRoot);
  const filtered = readAll().filter((item) => item.workspacePath !== workspacePath);
  writeAll([...filtered, { workspacePath, contextRoot: normalized }]);
}

export function clearStoredContextRoot(workspacePath: string): void {
  writeAll(readAll().filter((item) => item.workspacePath !== workspacePath));
}
