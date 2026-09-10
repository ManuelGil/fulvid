/**
 * Shared filesystem evidence types.
 *
 * These describe scan results from disk, not shell state or graph algorithms.
 */
import type { DocumentLink } from "../../document/links/documentLink";

export type MarkdownFileType = "md" | "markdown" | "mdx";

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
  tokens: number;
  words: number;
  /** Raw document content retained for workspace content search. */
  content?: string;
  /** True when the relative path includes a hidden segment (e.g. `.notes/…`). */
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
