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

/**
 * True when a path segment names a Windows device.
 *
 * Windows reads the device name from the text before the *first* dot, so
 * `CON.tar.md` reaches the console exactly as `CON.md` does. Measuring from the
 * last dot let every multi-suffix form of a reserved name through. A leading
 * dot means there is no stem (`.con` is an ordinary hidden file).
 */
export function isReservedDeviceName(segment: string): boolean {
  const firstDot = segment.indexOf(".");
  const stem = firstDot === -1 ? segment : segment.slice(0, firstDot);
  return stem !== "" && RESERVED_DEVICE_NAMES.has(stem.toLowerCase());
}

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
 * Shared basename refusals for Explorer create/rename (documents and folders):
 * no separators, traversal, reserved device names, or Windows-illegal characters.
 * Same refusal class as host `requireSafeBasename` / `isUnsafePathSegment`.
 */
function isSafePathBasename(name: string): boolean {
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
  return true;
}

/** Explorer New Folder names: basename only, not a document extension check. */
export function isSafeFolderBasename(name: string): boolean {
  if (!isSafePathBasename(name)) {
    return false;
  }
  return !isReservedDeviceName(name);
}

/**
 * Explorer create/rename document names must be basenames with a supported
 * Markdown/MDX extension.
 */
export function isSafeDocumentBasename(name: string): boolean {
  if (!isSafePathBasename(name) || !isMarkdownFile(name)) {
    return false;
  }
  const stem = name.replace(/\.[^.]+$/, "");
  return stem !== "" && !isReservedDeviceName(name);
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
