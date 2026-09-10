/**
 * The vocabulary the privileged host uses to refuse a filesystem request.
 *
 * A refusal has to cross the RPC boundary as a string, and only the message
 * survives that trip. Sending a code instead of a sentence keeps two properties
 * at once: the renderer can say it in the reader's language, and the host never
 * puts an absolute path, an errno or a stack into text the UI renders.
 *
 * Shared by both sides on purpose - this file must stay free of i18n and of any
 * runtime the Bun host cannot import.
 */
export const FILESYSTEM_ERROR_PREFIX = "fulvid.fs:";

export const FILESYSTEM_ERROR_CODES = [
  /** The folder was never approved through a native dialog. */
  "folderNotOpen",
  /** The chosen path is not a directory. */
  "notADirectory",
  /** Only .md, .markdown and .mdx are editable. */
  "unsupportedDocument",
  /** The requested name cannot be used as a filename. */
  "unsafeName",
  /** The target resolves outside the open folder. */
  "outsideFolder",
  /** The requested target is malformed. */
  "invalidTarget",
  /** The grant token no longer maps to a document. */
  "grantInvalid",
  /** The document is not on disk. */
  "documentMissing",
  /** A document already occupies the target. */
  "documentExists",
  /** A desktop action named a path outside every opened folder. */
  "outsideOpenedFolders",
  /** The document exceeds what the editor will load or write. */
  "documentTooLarge",
  /** The request did not match its contract. */
  "invalidRequest",
  /** The operation failed for a reason the host kept to itself. */
  "operationFailed",
] as const;

export type FilesystemErrorCode = (typeof FILESYSTEM_ERROR_CODES)[number];

const CODES = new Set<string>(FILESYSTEM_ERROR_CODES);

/** The wire form of a refusal: a code the renderer can translate. */
export function filesystemErrorMessage(code: FilesystemErrorCode): string {
  return `${FILESYSTEM_ERROR_PREFIX}${code}`;
}

/** The code carried by an error, or null when it is not one of ours. */
export function parseFilesystemErrorCode(value: unknown): FilesystemErrorCode | null {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  if (!message.startsWith(FILESYSTEM_ERROR_PREFIX)) {
    return null;
  }
  const code = message.slice(FILESYSTEM_ERROR_PREFIX.length).trim();
  return CODES.has(code) ? (code as FilesystemErrorCode) : null;
}

/** True when a save was refused because the file changed on disk meanwhile. */
export const DOCUMENT_CONFLICT_PREFIX = "fulvid.fs.conflict:";

/** The wire form of an external-modification conflict, naming the document. */
export function documentConflictMessage(path: string): string {
  return `${DOCUMENT_CONFLICT_PREFIX}${path}`;
}

/** The document path from a conflict error, or null when it is not one. */
export function parseDocumentConflictPath(value: unknown): string | null {
  const message = value instanceof Error ? value.message : typeof value === "string" ? value : "";
  return message.startsWith(DOCUMENT_CONFLICT_PREFIX)
    ? message.slice(DOCUMENT_CONFLICT_PREFIX.length)
    : null;
}

/**
 * An error whose message is already written for the reader.
 *
 * Some refusals originate in the renderer, where the localized sentence is
 * available at the throw site. Marking them keeps `describeFilesystemError`
 * from replacing a precise message with a generic fallback.
 */
export class LocalizedError extends Error {
  readonly localized = true;

  constructor(message: string) {
    super(message);
    this.name = "LocalizedError";
  }
}

export function isLocalizedError(value: unknown): value is LocalizedError {
  return value instanceof Error && (value as { localized?: unknown }).localized === true;
}

/**
 * A pending open that a newer request replaced.
 *
 * Not a failure: the person asked for something else before this one landed,
 * so surfacing it would report an error for an action they already abandoned.
 */
export class SupersededOpenError extends Error {
  readonly superseded = true;

  constructor() {
    super("Document open was superseded.");
    this.name = "SupersededOpenError";
  }
}

export function isSupersededOpen(value: unknown): boolean {
  return value instanceof Error && (value as { superseded?: unknown }).superseded === true;
}
