/**
 * Folder document I/O on the privileged host.
 *
 * Folder operations take `rootPath` + `relativePath` and go through
 * `assertWithinWorkspace` plus canonical containment. Open File / Save As
 * take a native-dialog path: extension and null-byte checks only, not folder
 * roots. Later standalone saves use a grant token that maps to that path.
 * HTML Export writes `.html` through the same dialog folder picker and
 * never issues a grant — the file is not a document buffer.
 *
 * Scan analysis is capped separately (`MAX_ANALYZED_BYTES`); this module
 * uses `MAX_DOCUMENT_BYTES` for open/save so a large note can still be
 * edited even when the folder scan truncated it.
 */
import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, relative, resolve } from "node:path";

import type {
  DocumentSnapshot,
  DocumentWriteResult,
} from "../../../mainview/modules/workspace/filesystem/workspaceTypes";
import { isMarkdownFile } from "../../../mainview/modules/workspace/filesystem/workspaceTypes";
import type { LinkSyntax } from "../../../mainview/modules/document/links/documentLink";
import { scannedNoteFromFile } from "../scanning/scanDirectory";
import {
  assertCanonicallyContained,
  containedPath,
  hasControlCharacters,
  WorkspaceBoundaryError,
} from "../security/workspacePaths";
import { MAX_DOCUMENT_BYTES } from "../rpc/rpcInput";
import {
  documentConflictMessage,
  filesystemErrorMessage,
} from "../../../mainview/modules/workspace/filesystem/workspaceErrors";

export class DocumentConflictError extends Error {
  readonly code = "DOCUMENT_CONFLICT";

  constructor(
    public readonly path: string,
    public readonly expectedMtimeMs: number,
    public readonly currentMtimeMs: number | null,
  ) {
    super(documentConflictMessage(path));
    this.name = "DocumentConflictError";
  }
}

/**
 * Resolve a workspace-relative target while keeping the workspace boundary
 * explicit for every document operation.
 *
 * Lexical only. Callers that touch the filesystem must also clear
 * `assertCanonicallyContained`, so a symlink inside the folder cannot move the
 * target outside the root after normalization.
 */
export function assertWithinWorkspace(rootPath: string, targetPath: string): string {
  return containedPath(rootPath, targetPath);
}

function assertStandaloneDocumentPath(targetPath: string): string {
  if (typeof targetPath !== "string" || targetPath.includes("\0")) {
    throw new WorkspaceBoundaryError("invalidTarget");
  }
  const absolutePath = resolve(targetPath);
  if (!isMarkdownFile(absolutePath)) {
    throw new WorkspaceBoundaryError("unsupportedDocument");
  }
  return absolutePath;
}

/** Names Windows refuses regardless of extension. */
const RESERVED_DEVICE_NAMES = new Set([
  "con",
  "prn",
  "aux",
  "nul",
  ...Array.from({ length: 9 }, (_, index) => `com${index + 1}`),
  ...Array.from({ length: 9 }, (_, index) => `lpt${index + 1}`),
]);

function requireSafeBasename(value: string): string {
  if (typeof value !== "string") {
    throw new WorkspaceBoundaryError("unsafeName");
  }
  const basenameValue = value.trim();
  if (
    !basenameValue ||
    basenameValue.length > 255 ||
    basenameValue === "." ||
    basenameValue === ".." ||
    basenameValue.includes("/") ||
    basenameValue.includes("\\") ||
    basenameValue.includes("\0") ||
    basenameValue.includes("..") ||
    hasControlCharacters(basenameValue) ||
    // Windows trims these silently, which would retarget the write.
    /[.\s]$/.test(basenameValue) ||
    /^[A-Za-z]:/.test(basenameValue) ||
    isAbsolute(basenameValue)
  ) {
    throw new WorkspaceBoundaryError("unsafeName");
  }
  return basenameValue;
}

function validateDocumentBasename(
  value: string,
  defaultExtension: "md" | "markdown" | "mdx" = "mdx",
): string {
  const basenameValue = requireSafeBasename(value);
  const extension = extname(basenameValue);
  const candidate = extension ? basenameValue : `${basenameValue}.${defaultExtension}`;
  const stem = basename(candidate).replace(/\.[^.]+$/, "");
  if (!isMarkdownFile(candidate) || stem === "") {
    throw new WorkspaceBoundaryError("unsafeName");
  }
  if (RESERVED_DEVICE_NAMES.has(stem.toLowerCase())) {
    throw new WorkspaceBoundaryError("unsafeName");
  }
  return candidate;
}

/**
 * HTML export names must be `.html` only so Export cannot overwrite a note.
 */
export function validateHtmlBasename(value: string): string {
  const basenameValue = requireSafeBasename(value);
  const extension = extname(basenameValue);
  const candidate = extension ? basenameValue : `${basenameValue}.html`;
  if (extname(candidate).toLowerCase() !== ".html") {
    throw new WorkspaceBoundaryError("unsafeName");
  }
  const stem = basename(candidate).slice(0, -extname(candidate).length);
  if (stem === "" || RESERVED_DEVICE_NAMES.has(stem.toLowerCase())) {
    throw new WorkspaceBoundaryError("unsafeName");
  }
  return `${stem}.html`;
}

function assertDocumentPath(rootPath: string, relativePath: string): string {
  const targetPath = assertWithinWorkspace(rootPath, relativePath);
  if (!isMarkdownFile(targetPath)) {
    throw new WorkspaceBoundaryError("unsupportedDocument");
  }
  return targetPath;
}

/**
 * The filesystem target for a folder document: supported extension, lexically
 * contained, and canonically contained once symlinks are resolved.
 */
async function resolveDocumentPath(rootPath: string, relativePath: string): Promise<string> {
  const targetPath = assertDocumentPath(rootPath, relativePath);
  await assertCanonicallyContained(rootPath, relativePath);
  return targetPath;
}

function workspaceRelativePath(rootPath: string, targetPath: string): string {
  return relative(resolve(rootPath), targetPath).replace(/\\/g, "/");
}

async function fileMtimeOrNull(targetPath: string): Promise<number | null> {
  try {
    const information = await stat(targetPath);
    if (!information.isFile()) {
      throw new Error(filesystemErrorMessage("invalidTarget"));
    }
    return information.mtimeMs;
  } catch (error) {
    if (
      error instanceof Error &&
      "code" in error &&
      (error as NodeJS.ErrnoException).code === "ENOENT"
    ) {
      return null;
    }
    throw error;
  }
}

/**
 * Refuse to pull a file into memory that the editor could not hold. The cap is
 * the same one the write path enforces, so a document that can be opened can
 * also be saved.
 */
async function assertReadableSize(targetPath: string): Promise<void> {
  const information = await stat(targetPath);
  if (information.size > MAX_DOCUMENT_BYTES) {
    throw new Error(filesystemErrorMessage("documentTooLarge"));
  }
}

async function assertExpectedMtime(
  targetPath: string,
  relativePath: string,
  expectedMtimeMs: number | undefined,
): Promise<number | null> {
  const currentMtimeMs = await fileMtimeOrNull(targetPath);
  if (expectedMtimeMs !== undefined && currentMtimeMs !== expectedMtimeMs) {
    throw new DocumentConflictError(relativePath, expectedMtimeMs, currentMtimeMs);
  }
  return currentMtimeMs;
}

/**
 * Replace `targetPath` by writing a unique temp file (`wx`) then renaming over
 * it. Same-filesystem rename is atomic; it is not compare-and-replace.
 *
 * Callers that `stat` mtime first still have a window: another process can
 * replace the file after the check and this rename will overwrite it. Bun's
 * `fs.rename` has no "replace only if unchanged" option.
 *
 * TODO(security): Revisit if the runtime grows an atomic compare-and-replace
 * (mtime or generation CAS). Do not add advisory locks for this. mtime
 * mismatch still detects the usual external-edit case; it cannot make
 * check+replace indivisible.
 */
async function writeAtomically(targetPath: string, content: string): Promise<void> {
  const temporaryPath = `${targetPath}.${randomUUID()}.tmp`;

  try {
    await writeFile(temporaryPath, content, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, targetPath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

/**
 * Create a document only if nothing is there.
 *
 * Checking for the file and then renaming over it leaves a window in which
 * something else can create it, and the rename would overwrite that silently.
 * An exclusive create closes the window: the filesystem itself decides, and a
 * loser gets `EEXIST` rather than someone else's document replaced.
 */
async function createExclusively(targetPath: string, content: string): Promise<boolean> {
  try {
    await writeFile(targetPath, content, { encoding: "utf8", flag: "wx" });
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "EEXIST") {
      return false;
    }
    throw error;
  }
}

async function readFileContentWithMtimeCheck(
  targetPath: string,
): Promise<{ content: string; mtimeMs: number }> {
  const initialMtimeMs = await fileMtimeOrNull(targetPath);
  if (initialMtimeMs === null) {
    throw new Error(filesystemErrorMessage("documentMissing"));
  }
  await assertReadableSize(targetPath);

  const content = await readFile(targetPath, "utf8");
  const finalMtimeMs = await fileMtimeOrNull(targetPath);
  if (finalMtimeMs === null) {
    throw new Error(filesystemErrorMessage("operationFailed"));
  }

  return { content, mtimeMs: finalMtimeMs };
}

/**
 * Read a folder document after lexical + canonical containment.
 * The returned `absolutePath` is document identity for the renderer.
 */
export async function readDocument(
  rootPath: string,
  relativePath: string,
): Promise<DocumentSnapshot> {
  const targetPath = await resolveDocumentPath(rootPath, relativePath);
  const { content, mtimeMs } = await readFileContentWithMtimeCheck(targetPath);

  return {
    path: workspaceRelativePath(rootPath, targetPath),
    absolutePath: targetPath,
    content,
    mtimeMs,
  };
}

/**
 * Atomic replace of a folder document after containment checks.
 *
 * `expectedMtimeMs` is the last mtime the renderer observed; a mismatch
 * becomes DocumentConflictError. That check is not fused with the rename
 * in `writeAtomically`.
 */
export async function writeDocument(
  rootPath: string,
  relativePath: string,
  content: string,
  expectedMtimeMs?: number,
  linkMode: LinkSyntax = "markdown",
): Promise<DocumentWriteResult> {
  const targetPath = await resolveDocumentPath(rootPath, relativePath);
  const currentMtimeMs = await assertExpectedMtime(targetPath, relativePath, expectedMtimeMs);
  if (currentMtimeMs === null) {
    throw new Error(filesystemErrorMessage("documentMissing"));
  }

  await writeAtomically(targetPath, content);
  const note = await scannedNoteFromFile(rootPath, targetPath, linkMode);
  const mtimeMs = await fileMtimeOrNull(targetPath);
  if (mtimeMs === null) {
    throw new Error(filesystemErrorMessage("operationFailed"));
  }

  return { note, absolutePath: targetPath, mtimeMs };
}

export async function createDocument(
  rootPath: string,
  relativePath: string,
  content: string,
  linkMode: LinkSyntax = "markdown",
): Promise<DocumentWriteResult> {
  const targetPath = await resolveDocumentPath(rootPath, relativePath);
  const currentMtimeMs = await fileMtimeOrNull(targetPath);
  if (currentMtimeMs !== null) {
    throw new Error(filesystemErrorMessage("documentExists"));
  }

  await mkdir(dirname(targetPath), { recursive: true });
  if (!(await createExclusively(targetPath, content))) {
    throw new Error(filesystemErrorMessage("documentExists"));
  }
  const note = await scannedNoteFromFile(rootPath, targetPath, linkMode);
  const mtimeMs = await fileMtimeOrNull(targetPath);
  if (mtimeMs === null) {
    throw new Error(filesystemErrorMessage("operationFailed"));
  }

  return { note, absolutePath: targetPath, mtimeMs };
}

export async function renameDocument(
  rootPath: string,
  relativePath: string,
  nextRelativePath: string,
  expectedMtimeMs?: number,
  linkMode: LinkSyntax = "markdown",
): Promise<DocumentWriteResult> {
  const targetPath = await resolveDocumentPath(rootPath, relativePath);
  const nextTargetPath = await resolveDocumentPath(rootPath, nextRelativePath);
  const currentMtimeMs = await assertExpectedMtime(targetPath, relativePath, expectedMtimeMs);
  if (currentMtimeMs === null) {
    throw new Error(filesystemErrorMessage("documentMissing"));
  }

  if ((await fileMtimeOrNull(nextTargetPath)) !== null) {
    throw new Error(filesystemErrorMessage("documentExists"));
  }

  await mkdir(dirname(nextTargetPath), { recursive: true });
  await rename(targetPath, nextTargetPath);
  const note = await scannedNoteFromFile(rootPath, nextTargetPath, linkMode);
  const mtimeMs = await fileMtimeOrNull(nextTargetPath);
  if (mtimeMs === null) {
    throw new Error(filesystemErrorMessage("operationFailed"));
  }

  return { note, absolutePath: nextTargetPath, mtimeMs };
}

/**
 * Open File: read a dialog-chosen Markdown/MDX path that is not folder-relative.
 *
 * The native dialog is the trust source. This function does not check folder
 * containment; `assertStandaloneDocumentPath` only rejects unsupported names
 * and null bytes. Later saves require a grant of this same canonical path.
 */
export async function readSelectedDocument(
  selectedPath: string,
): Promise<{ absolutePath: string; content: string; mtimeMs: number }> {
  const targetPath = assertStandaloneDocumentPath(selectedPath);
  const { content, mtimeMs } = await readFileContentWithMtimeCheck(targetPath);

  return { absolutePath: targetPath, content, mtimeMs };
}

async function writeSelectedBasename(
  selectedFolder: string,
  filename: string,
  content: string,
  overwrite: boolean,
): Promise<
  | { status: "saved"; absolutePath: string; mtimeMs: number }
  | { status: "exists"; absolutePath: string }
> {
  const folderPath = resolve(selectedFolder);
  // The folder came from a native dialog, but the name came from the renderer:
  // prove the join stays in the chosen folder even through a symlinked name.
  const targetPath = containedPath(folderPath, filename);
  await assertCanonicallyContained(folderPath, filename);

  if (!overwrite) {
    // Let the filesystem decide whether this name is free, so a file that
    // appears between the check and the write is reported, not replaced.
    if (!(await createExclusively(targetPath, content))) {
      return { status: "exists", absolutePath: targetPath };
    }
  } else {
    await writeAtomically(targetPath, content);
  }
  const mtimeMs = await fileMtimeOrNull(targetPath);
  if (mtimeMs === null) {
    throw new Error(filesystemErrorMessage("operationFailed"));
  }
  return { status: "saved", absolutePath: targetPath, mtimeMs };
}

export async function saveSelectedDocument(
  selectedFolder: string,
  requestedBasename: string,
  content: string,
  defaultExtension: "md" | "markdown" | "mdx" = "mdx",
  overwrite = false,
): Promise<
  | { status: "saved"; absolutePath: string; mtimeMs: number }
  | { status: "exists"; absolutePath: string }
> {
  return writeSelectedBasename(
    selectedFolder,
    validateDocumentBasename(requestedBasename, defaultExtension),
    content,
    overwrite,
  );
}

/**
 * Write an HTML export chosen by native dialog.
 *
 * Not a document grant: the file is not opened as a buffer, does not join
 * dirty/save, and must be `.html` only so Export cannot overwrite a note.
 */
export async function saveSelectedHtmlExport(
  selectedFolder: string,
  requestedBasename: string,
  content: string,
  overwrite = false,
): Promise<
  | { status: "saved"; absolutePath: string; mtimeMs: number }
  | { status: "exists"; absolutePath: string }
> {
  return writeSelectedBasename(
    selectedFolder,
    validateHtmlBasename(requestedBasename),
    content,
    overwrite,
  );
}

/**
 * Save a standalone document the person already opened or saved via dialog.
 *
 * The write target is the grant's absolute path. RPC must not supply a
 * different path; `grantedPath` is resolved before this function runs.
 */
export async function writeGrantedDocument(
  selectedPath: string,
  content: string,
  expectedMtimeMs: number,
): Promise<{ absolutePath: string; mtimeMs: number }> {
  const targetPath = assertStandaloneDocumentPath(selectedPath);
  // Report the document by name: the grant already proves which file it is, and
  // the absolute path does not belong in a message the renderer renders.
  await assertExpectedMtime(targetPath, basename(targetPath), expectedMtimeMs);
  await writeAtomically(targetPath, content);
  const mtimeMs = await fileMtimeOrNull(targetPath);
  if (mtimeMs === null) {
    throw new Error(filesystemErrorMessage("operationFailed"));
  }
  return { absolutePath: targetPath, mtimeMs };
}

export async function grantDetachedWorkspaceDocument(
  rootPath: string,
  relativePath: string,
): Promise<{ absolutePath: string; mtimeMs: number }> {
  const targetPath = await resolveDocumentPath(rootPath, relativePath);
  const mtimeMs = await fileMtimeOrNull(targetPath);
  if (mtimeMs === null) {
    throw new Error(filesystemErrorMessage("documentMissing"));
  }
  return { absolutePath: targetPath, mtimeMs };
}

export async function deleteDocument(
  rootPath: string,
  relativePath: string,
  expectedMtimeMs?: number,
): Promise<boolean> {
  const targetPath = await resolveDocumentPath(rootPath, relativePath);
  const currentMtimeMs = await assertExpectedMtime(targetPath, relativePath, expectedMtimeMs);
  if (currentMtimeMs === null) {
    throw new Error(filesystemErrorMessage("documentMissing"));
  }

  await unlink(targetPath);
  return true;
}
