/**
 * UI-facing filesystem access: Electrobun RPC client for scan and desktop actions.
 */
import { desktopRequest } from "../../../desktop/electrobunClient";
import type {
  DocumentSnapshot,
  DocumentWriteResult,
  GrantedDocumentSnapshot,
  GrantedDocumentWriteResult,
  FileSystemEntry,
  HtmlExportResult,
  SaveAsResult,
  WorkspaceScan,
} from "./workspaceTypes";
import type { LinkSyntax } from "../../document/links/documentLink";
import {
  isLocalizedError,
  isSupersededOpen,
  parseDocumentConflictPath,
  parseFilesystemErrorCode,
} from "./workspaceErrors";
import { i18n } from "../../../i18n";

const SCAN_TIMEOUT_MS = 50_000;

/**
 * Turn a refusal from the privileged host into something a reader can act on.
 *
 * The host answers with a code, never a sentence, so this is the only place
 * that decides how a filesystem failure reads - in the reader's language, and
 * without a host path or errno in it. Anything unrecognized falls back to the
 * caller's own message rather than being shown raw.
 */
export function describeFilesystemError(error: unknown, fallbackKey: string): string {
  if (isLocalizedError(error)) {
    return error.message;
  }
  const conflictPath = parseDocumentConflictPath(error);
  if (conflictPath !== null) {
    return i18n.global.t("workspace.externalChange", { name: conflictPath });
  }
  const code = parseFilesystemErrorCode(error);
  if (code) {
    return i18n.global.t(`filesystemErrors.${code}`);
  }
  return i18n.global.t(fallbackKey);
}

/**
 * Report a filesystem failure to the reader, unless it was an open that a newer
 * request replaced - the person already moved on, so there is nothing to say.
 */
export function notifyFilesystemError(
  error: unknown,
  fallbackKey: string,
  report: (message: string) => void,
): void {
  if (isSupersededOpen(error)) {
    return;
  }
  const message = describeFilesystemError(error, fallbackKey);
  report(message);
}

export async function pickWorkspacePath(): Promise<string | null> {
  return desktopRequest().openWorkspace({});
}

/** Re-authorize a persisted recent-folder path in the native process. */
export async function authorizeWorkspacePath(path: string): Promise<string | null> {
  return desktopRequest().openWorkspace({ path });
}

export async function pickAndOpenDocument(): Promise<GrantedDocumentSnapshot | null> {
  return desktopRequest().pickAndOpenDocument({});
}

export async function pickAndSaveDocument(
  basename: string,
  content: string,
  defaultExtension: "md" | "markdown" | "mdx",
  overwrite = false,
): Promise<SaveAsResult> {
  return desktopRequest().pickAndSaveDocument({
    basename,
    content,
    defaultExtension,
    overwrite,
  });
}

/**
 * Renderer-side HTML Export: native folder dialog plus `.html` write.
 * Not a document grant and not a dirty/save of the current buffer.
 */
export async function pickAndSaveHtmlExport(
  basename: string,
  content: string,
  overwrite = false,
): Promise<HtmlExportResult> {
  return desktopRequest().pickAndSaveHtmlExport({
    basename,
    content,
    overwrite,
  });
}

export async function writeGrantedDocument(
  grantToken: string,
  content: string,
  expectedMtimeMs: number,
): Promise<GrantedDocumentWriteResult> {
  return desktopRequest().writeGrantedDocument({
    grantToken,
    content,
    expectedMtimeMs,
  });
}

export async function grantDetachedWorkspaceDocument(
  rootPath: string,
  relativePath: string,
): Promise<{ absolutePath: string; mtimeMs: number; grantToken: string }> {
  return desktopRequest().grantDetachedWorkspaceDocument({
    rootPath,
    relativePath,
  });
}

export async function scanWorkspace(
  rootPath: string,
  includeHidden = false,
  linkMode: LinkSyntax = "markdown",
): Promise<WorkspaceScan> {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      desktopRequest().scanWorkspace({
        path: rootPath,
        includeHidden,
        linkMode,
      }),
      new Promise<never>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(i18n.global.t("workspace.scanTimeout")));
        }, SCAN_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

export async function listDirectory(
  rootPath: string,
  relativePath = "",
  includeHidden = false,
): Promise<FileSystemEntry[]> {
  return desktopRequest().listDirectory({
    rootPath,
    relativePath,
    includeHidden,
  });
}

export async function revealInExplorer(path: string): Promise<void> {
  await desktopRequest().revealInExplorer({ path });
}

export async function copyPathToClipboard(path: string): Promise<void> {
  await desktopRequest().copyPath({ path });
}

export async function readDocument(
  rootPath: string,
  relativePath: string,
): Promise<DocumentSnapshot> {
  return desktopRequest().readDocument({ rootPath, relativePath });
}

export async function writeDocument(
  rootPath: string,
  relativePath: string,
  content: string,
  expectedMtimeMs: number,
  linkMode: LinkSyntax = "markdown",
): Promise<DocumentWriteResult> {
  return desktopRequest().writeDocument({
    rootPath,
    relativePath,
    content,
    expectedMtimeMs,
    linkMode,
  });
}

export async function createDocument(
  rootPath: string,
  relativePath: string,
  content: string,
  linkMode: LinkSyntax = "markdown",
): Promise<DocumentWriteResult> {
  return desktopRequest().createDocument({
    rootPath,
    relativePath,
    content,
    linkMode,
  });
}

export async function createDirectory(
  rootPath: string,
  relativePath: string,
): Promise<{ path: string }> {
  return desktopRequest().createDirectory({
    rootPath,
    relativePath,
  });
}

export async function renameDocument(
  rootPath: string,
  relativePath: string,
  nextRelativePath: string,
  expectedMtimeMs?: number,
  linkMode: LinkSyntax = "markdown",
): Promise<DocumentWriteResult> {
  return desktopRequest().renameDocument({
    rootPath,
    relativePath,
    nextRelativePath,
    expectedMtimeMs,
    linkMode,
  });
}

export async function deleteDocument(
  rootPath: string,
  relativePath: string,
  expectedMtimeMs?: number,
): Promise<boolean> {
  return desktopRequest().deleteDocument({
    rootPath,
    relativePath,
    expectedMtimeMs,
  });
}
