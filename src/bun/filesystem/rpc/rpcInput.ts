/**
 * RPC input validation for the privileged host.
 *
 * The renderer is the untrusted side of the boundary: every field arrives as
 * `unknown`, is checked for type, shape and size here, and is rejected with a
 * stable, non-revealing message when it does not fit the contract. Validation
 * that already exists in the UI is a convenience, never an authority.
 */
import type { LinkSyntax } from "../../../mainview/modules/document/links/documentLink";
import {
  filesystemErrorMessage,
  type FilesystemErrorCode,
} from "../../../mainview/modules/workspace/filesystem/workspaceErrors";
import type { MarkdownFileType } from "../../../mainview/modules/workspace/filesystem/workspaceTypes";

/** Largest document body accepted from, or returned to, the renderer. Scan/search use the smaller `MAX_ANALYZED_BYTES`. */
export const MAX_DOCUMENT_BYTES = 32 * 1024 * 1024;
/** Longest absolute path accepted from the renderer. */
const MAX_PATH_LENGTH = 4096;
/** Longest filename accepted from the renderer. */
const MAX_BASENAME_LENGTH = 255;

/**
 * A request that did not match its contract. Like every boundary refusal it
 * travels as a code: the field that failed stays in the host, because naming it
 * back to the renderer describes the host's shape without helping the reader.
 */
export class RpcInputError extends Error {
  constructor(readonly reason: FilesystemErrorCode = "invalidRequest") {
    super(filesystemErrorMessage(reason));
    this.name = "RpcInputError";
  }
}

function reject(reason: FilesystemErrorCode = "invalidRequest"): never {
  throw new RpcInputError(reason);
}

function record(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== "object" || Array.isArray(params)) {
    reject();
  }
  return params as Record<string, unknown>;
}

export function requireString(params: unknown, field: string, maxLength = MAX_PATH_LENGTH): string {
  const value = record(params)[field];
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > maxLength ||
    value.includes("\0")
  ) {
    reject();
  }
  return value;
}

export function optionalString(
  params: unknown,
  field: string,
  fallback: string,
  maxLength = MAX_PATH_LENGTH,
): string {
  const value = record(params)[field];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "string" || value.length > maxLength || value.includes("\0")) {
    reject();
  }
  return value;
}

export function optionalBoolean(params: unknown, field: string, fallback: boolean): boolean {
  const value = record(params)[field];
  if (value === undefined || value === null) {
    return fallback;
  }
  if (typeof value !== "boolean") {
    reject();
  }
  return value;
}

export function requireDocumentContent(params: unknown): string {
  const value = record(params).content;
  if (typeof value !== "string") {
    reject();
  }
  if (Buffer.byteLength(value, "utf8") > MAX_DOCUMENT_BYTES) {
    reject("documentTooLarge");
  }
  return value;
}

export function optionalMtime(params: unknown, field = "expectedMtimeMs"): number | undefined {
  const value = record(params)[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    reject();
  }
  return value;
}

export function requireMtime(params: unknown, field = "expectedMtimeMs"): number {
  const value = optionalMtime(params, field);
  if (value === undefined) {
    reject();
  }
  return value;
}

const LINK_SYNTAXES = new Set<LinkSyntax>(["markdown", "wikilink"]);

export function requireLinkMode(params: unknown): LinkSyntax {
  const value = record(params).linkMode;
  if (typeof value !== "string" || !LINK_SYNTAXES.has(value as LinkSyntax)) {
    reject();
  }
  return value as LinkSyntax;
}

const DOCUMENT_EXTENSIONS = new Set<MarkdownFileType>(["md", "markdown", "mdx"]);

export function requireDefaultExtension(params: unknown): MarkdownFileType {
  const value = record(params).defaultExtension;
  if (typeof value !== "string" || !DOCUMENT_EXTENSIONS.has(value as MarkdownFileType)) {
    reject();
  }
  return value as MarkdownFileType;
}

export function requireBasename(params: unknown): string {
  return requireString(params, "basename", MAX_BASENAME_LENGTH);
}

const GRANT_TOKEN_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requireGrantToken(params: unknown): string {
  const value = requireString(params, "grantToken", 64);
  if (!GRANT_TOKEN_RE.test(value)) {
    reject("grantInvalid");
  }
  return value;
}
