/**
 * Folder containment - the single privileged authority for turning a
 * renderer-supplied `rootPath` + `relativePath` pair into a filesystem target.
 *
 * Every path that crosses the RPC boundary passes through here twice:
 *
 *   1. a lexical pass that rejects malformed, absolute and traversal targets;
 *   2. a canonical pass that resolves symlinks and re-checks containment, so a
 *      link inside the folder cannot point the operation outside its root.
 *
 * Callers operate on the lexical target. The canonical target exists to make
 * the containment decision, not to rename the document: reporting a resolved
 * path back to the renderer would change document identity for aliased paths.
 */
import { realpath } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";

import {
  filesystemErrorMessage,
  type FilesystemErrorCode,
} from "../../../mainview/modules/workspace/filesystem/workspaceErrors";
import { isReservedDeviceName } from "../../../mainview/modules/workspace/filesystem/workspaceTypes";

/** Longest relative path accepted from the renderer. */
const MAX_RELATIVE_PATH_LENGTH = 1024;
/** Longest single path segment accepted from the renderer. */
const MAX_SEGMENT_LENGTH = 255;
/** Deepest relative path accepted from the renderer. */
const MAX_PATH_DEPTH = 32;

/**
 * A refusal at the folder boundary. It travels as a code, not a sentence, so
 * the renderer localizes it and no host path reaches the UI.
 */
export class WorkspaceBoundaryError extends Error {
  constructor(readonly reason: FilesystemErrorCode) {
    super(filesystemErrorMessage(reason));
    this.name = "WorkspaceBoundaryError";
  }
}

function reject(reason: FilesystemErrorCode): never {
  throw new WorkspaceBoundaryError(reason);
}

/** C0 controls and DEL. Shared with basename validation in document I/O. */
export function hasControlCharacters(value: string): boolean {
  for (const character of value) {
    const code = character.codePointAt(0) ?? 0;
    if (code < 0x20 || code === 0x7f) {
      return true;
    }
  }
  return false;
}

/** Characters illegal in Windows path segments (includes ADS `:`). */
const WINDOWS_ILLEGAL_SEGMENT_CHARS = /[<>:"|?*]/;

/**
 * True when a path segment would be a reserved device name or otherwise unsafe
 * on Windows (trailing dot/space, illegal characters).
 */
export function isUnsafePathSegment(segment: string): boolean {
  if (!segment || segment !== segment.trim() || /[.\s]$/.test(segment)) {
    return true;
  }
  if (WINDOWS_ILLEGAL_SEGMENT_CHARS.test(segment)) {
    return true;
  }
  return isReservedDeviceName(segment);
}

/**
 * Split a renderer-supplied relative path into safe segments.
 *
 * Both separators are accepted because documents and the Explorer speak POSIX
 * paths while Windows hosts report backslashes; anything that changes meaning
 * after normalization is rejected rather than repaired.
 */
export function workspaceRelativeSegments(relativePath: string): string[] {
  if (typeof relativePath !== "string") {
    reject("invalidTarget");
  }
  if (relativePath.length > MAX_RELATIVE_PATH_LENGTH) {
    reject("invalidTarget");
  }
  if (relativePath.includes("\0") || hasControlCharacters(relativePath)) {
    reject("invalidTarget");
  }
  if (isAbsolute(relativePath) || /^[A-Za-z]:/.test(relativePath)) {
    reject("outsideFolder");
  }
  // Refuse padded paths rather than trim: Windows strips trailing dots/spaces
  // and would retarget the operation to a different path.
  if (relativePath !== relativePath.trim()) {
    reject("invalidTarget");
  }

  const normalized = relativePath.replace(/\\/g, "/");
  if (normalized.startsWith("/")) {
    reject("outsideFolder");
  }

  const segments = normalized.split("/").filter((segment) => segment.length > 0);
  if (segments.some((segment) => segment === "." || segment === "..")) {
    reject("outsideFolder");
  }
  if (segments.some((segment) => segment.length > MAX_SEGMENT_LENGTH)) {
    reject("invalidTarget");
  }
  if (segments.some((segment) => isUnsafePathSegment(segment))) {
    reject("unsafeName");
  }
  if (segments.length > MAX_PATH_DEPTH) {
    reject("invalidTarget");
  }

  return segments;
}

/** Normalized POSIX form of a relative path, or "" for the folder root. */
export function normalizeWorkspaceRelativePath(relativePath: string): string {
  return workspaceRelativeSegments(relativePath).join("/");
}

/**
 * Lexical containment: resolve `relativePath` under `rootPath` and prove the
 * result stays inside the root without trusting string prefixes.
 */
export function containedPath(rootPath: string, relativePath: string): string {
  const segments = workspaceRelativeSegments(relativePath);
  const root = resolve(rootPath);
  const target = segments.length === 0 ? root : resolve(root, segments.join("/"));
  assertLexicallyContained(root, target);
  return target;
}

function assertLexicallyContained(root: string, target: string): void {
  if (target === root) {
    return;
  }
  const relativeTarget = relative(root, target);
  if (
    relativeTarget === "" ||
    relativeTarget === ".." ||
    relativeTarget.startsWith(`..${sep}`) ||
    isAbsolute(relativeTarget)
  ) {
    reject("outsideFolder");
  }
}

/** The canonical (symlink-resolved) form of a folder root. */
export async function canonicalRoot(rootPath: string): Promise<string> {
  try {
    return await realpath(resolve(rootPath));
  } catch {
    return resolve(rootPath);
  }
}

/**
 * Canonical containment: resolve every existing segment of the target through
 * symlinks and prove the result is still inside the canonical root.
 *
 * Missing trailing segments (a document being created, a rename destination)
 * are appended unresolved - they cannot be a symlink because they do not exist.
 */
export async function assertCanonicallyContained(
  rootPath: string,
  relativePath: string,
): Promise<string> {
  const segments = workspaceRelativeSegments(relativePath);
  const root = await canonicalRoot(rootPath);

  let current = root;
  let exists = true;
  for (const segment of segments) {
    const candidate = join(current, segment);
    if (!exists) {
      // Nothing from here down exists yet, so no segment can be a symlink.
      current = candidate;
      continue;
    }
    try {
      current = await realpath(candidate);
      assertLexicallyContained(root, current);
    } catch (error) {
      if (!isMissingEntry(error)) {
        throw error;
      }
      exists = false;
      current = candidate;
    }
  }

  assertLexicallyContained(root, current);
  return current;
}

function isMissingEntry(error: unknown): boolean {
  const code = (error as NodeJS.ErrnoException | null)?.code;
  return code === "ENOENT" || code === "ENOTDIR";
}
