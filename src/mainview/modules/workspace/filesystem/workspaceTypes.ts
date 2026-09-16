/**
 * Shared filesystem evidence types.
 *
 * These describe scan results from disk, not shell state or graph algorithms.
 */
import type { DocumentLink } from "../../document/links/documentLink";

export type MarkdownFileType = "md" | "markdown" | "mdx";

/** Names Windows refuses regardless of extension (CON, PRN, COM1, ...). */
export const RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

/** Which supported document extension a path uses, if any. */
export function documentFileType(path: string): MarkdownFileType | null {
  const lower = path.toLowerCase();
  if (lower.endsWith(".mdx")) {
    return "mdx";
  }
  if (lower.endsWith(".markdown")) {
    return "markdown";
  }
  if (lower.endsWith(".md")) {
    return "md";
  }
  return null;
}

/** Single renderer/native authority for supported document extensions. */
export function isMarkdownFile(path: string): boolean {
  return documentFileType(path) !== null;
}

/**
 * Explorer create/rename names must be basenames only - same refusal class as
 * host `requireSafeBasename` (no separators, traversal, reserved names, or
 * Windows-illegal characters).
 */
export function isSafeDocumentBasename(name: string): boolean {
  const basenameValue = name.trim();
  if (
    !basenameValue ||
    basenameValue !== name ||
    basenameValue.length > 255 ||
    basenameValue === "." ||
    basenameValue === ".." ||
    basenameValue.includes("/") ||
    basenameValue.includes("\\") ||
    basenameValue.includes("\0") ||
    basenameValue.includes("..") ||
    /[.\s]$/.test(basenameValue) ||
    /[<>:"|?*]/.test(basenameValue) ||
    /^[A-Za-z]:/.test(basenameValue)
  ) {
    return false;
  }
  if (!isMarkdownFile(basenameValue)) {
    return false;
  }
  const stem = basenameValue.replace(/\.[^.]+$/, "");
  return stem !== "" && !RESERVED_DEVICE_NAMES.has(stem.toLowerCase());
}

export interface ScannedNote {
  path: string;
  name: string;
  title: string;
  aliases: string[];
  documentLinks: DocumentLink[];
  tags: string[];
  categories: string[];
  projects: string[];
  summary: string;
  words: number;
  /** Raw document content retained for workspace content search. */
  content?: string;
  /** True when the relative path includes a hidden segment (e.g. `.notes/...`). */
  hidden?: boolean;
}

export interface FileSystemEntry {
  kind: "directory" | "file";
  name: string;
  path: string;
  hidden?: boolean;
}

export interface WorkspaceScan {
  path: string;
  scannedNotes: ScannedNote[];
  /** True when the folder held more documents than one scan may load. */
  truncated?: boolean;
  /** Entries skipped because they could not be read while scanning. */
  skipped?: number;
}

export interface DocumentSnapshot {
  path: string;
  absolutePath: string;
  content: string;
  mtimeMs: number;
}

export interface DocumentWriteResult {
  note: ScannedNote;
  absolutePath: string;
  mtimeMs: number;
}

export interface GrantedDocumentSnapshot {
  absolutePath: string;
  content: string;
  mtimeMs: number;
  grantToken: string;
}

export interface GrantedDocumentWriteResult {
  absolutePath: string;
  mtimeMs: number;
  grantToken: string;
}

export type SaveAsResult =
  | {
      status: "saved";
      absolutePath: string;
      mtimeMs: number;
      grantToken: string;
    }
  | {
      status: "exists";
      absolutePath: string;
    }
  | {
      status: "cancelled";
    };

export type HtmlExportResult =
  | {
      status: "saved";
      absolutePath: string;
    }
  | {
      status: "exists";
      absolutePath: string;
    }
  | {
      status: "cancelled";
    };
